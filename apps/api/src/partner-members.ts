import type { Actor, PartnerTemplate } from "@corvo/contracts";
import { PartnerTemplate as PartnerTemplateSchema } from "@corvo/contracts";
import type { ResolvedPartnerRole } from "@corvo/core";
import { resolvePartnerRole } from "@corvo/core";
import type {
  AdmittedPartnerMember,
  PartnerEntry,
  PartnerMemberInput,
  PrismaClient,
} from "@corvo/db";
import { runAsSystem } from "@corvo/db";
import type { PartnerContent } from "./partner-content.js";

/** What admitting a person needs from the database and the agent installer. */
export interface PartnerMemberDeps {
  /** The partner's template, or undefined when it has none. */
  template(partnerId: string): Promise<PartnerTemplate | undefined>;
  admit(input: PartnerMemberInput): Promise<AdmittedPartnerMember>;
  /** Makes (or finds) the person's own copies of the agents their role talks to. */
  installForMember(
    actor: Actor,
    partnerId: string,
    content: PartnerContent,
  ): Promise<{ botIds: Record<string, string> }>;
  /** Keeps the customer's own agents and everyone else's copies out of this person's reach. */
  seal(input: {
    organizationId: string;
    ownerUserId: string;
    partnerId: string;
    userId: string;
    allowedAgentKeys: readonly string[];
  }): Promise<void>;
}

const OWNER_EMAIL = "owner@partner.invalid";

/** A template agent's key in a space; a person's own copy of it carries their user id as well. */
export function partnerAgentSpawnKey(partnerId: string, agentKey: string, forUserId?: string) {
  return `partner:${partnerId}:${agentKey}${forUserId ? `:m:${forUserId}` : ""}`;
}

/**
 * Turns a spent entry code into the user the session opens. A session that names no role, or the
 * owner, opens the customer's owner as it always did. Any other role opens a user of that
 * person's own, holding only what the template gives the role: its agents (their own copies, so
 * their conversations are theirs), its rights and the scope the partner sent. The role is read
 * again on every session, so a change on the partner's side holds the next time they open.
 */
export async function admitPartnerEntry(
  deps: PartnerMemberDeps,
  entry: PartnerEntry,
): Promise<{ userId: string; role: ResolvedPartnerRole }> {
  const template = await deps.template(entry.partnerId);
  const role = resolvePartnerRole(template, entry.role);
  const admitted = await deps.admit({
    tenantId: entry.tenantId,
    organizationId: entry.organizationId,
    ownerUserId: entry.userId,
    externalUserId: entry.externalUserId,
    externalEmail: entry.externalEmail,
    role: role.name,
    scope: entry.scope,
    permissions: role.permissions,
  });
  if (!role.owner && template) {
    const actor: Actor = {
      spaceId: entry.organizationId,
      userId: entry.userId,
      email: OWNER_EMAIL,
      isDeploymentOwner: false,
    };
    const agents = template.agents.filter((agent) => role.agents.includes(agent.key));
    if (agents.length > 0) {
      await deps.installForMember(actor, entry.partnerId, {
        connectorSlug: template.connector?.slug,
        forUserId: admitted.userId,
        agents,
      });
    }
    await deps.seal({
      organizationId: entry.organizationId,
      ownerUserId: entry.userId,
      partnerId: entry.partnerId,
      userId: admitted.userId,
      allowedAgentKeys: agents.map((agent) => agent.key),
    });
  }
  return { userId: admitted.userId, role };
}

/** The Prisma side of `seal`: archives copies the role no longer has and closes the owner's agents. */
export async function sealMemberAgents(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    ownerUserId: string;
    partnerId: string;
    userId: string;
    allowedAgentKeys: readonly string[];
  },
): Promise<void> {
  const prefix = `partner:${input.partnerId}:`;
  const suffix = `:m:${input.userId}`;
  const mine = await prisma.bot.findMany({
    where: {
      spaceId: input.organizationId,
      spawnKey: { startsWith: prefix, endsWith: suffix },
    },
    select: { id: true, spawnKey: true, archivedAt: true },
  });
  const allowed = new Set(
    input.allowedAgentKeys.map((key) => partnerAgentSpawnKey(input.partnerId, key, input.userId)),
  );
  const now = new Date();
  for (const bot of mine) {
    const keep = allowed.has(bot.spawnKey ?? "");
    if (keep && bot.archivedAt) {
      await prisma.bot.update({ where: { id: bot.id }, data: { archivedAt: null } });
    } else if (!keep && !bot.archivedAt) {
      await prisma.bot.update({ where: { id: bot.id }, data: { archivedAt: now } });
    }
  }
  // The customer's own agents (the Chief and the template's) answer to the customer alone, once
  // anyone else has a seat; a copy made for one person answers to that person alone.
  await prisma.bot.updateMany({
    where: {
      spaceId: input.organizationId,
      userId: input.ownerUserId,
      audienceRestricted: false,
    },
    data: { audienceRestricted: true, audienceUserIds: [], audienceRoleIds: [] },
  });
}

/** Reads the template of a partner row, or undefined when it is missing or malformed. */
export function readTemplate(value: unknown): PartnerTemplate | undefined {
  return PartnerTemplateSchema.safeParse(value).data;
}

/**
 * Of a customer's agents, the ones a person is meant to see: what is not restricted, what is
 * restricted to them, and the customer's own to the customer. Another person's copy of an agent
 * is not there for anyone else, the customer included.
 */
export function visibleAgentIds(
  bots: ReadonlyArray<{
    id: string;
    userId: string;
    audienceRestricted: boolean;
    audienceUserIds: readonly string[];
  }>,
  personId: string,
): Set<string> {
  return new Set(
    bots
      .filter((bot) => {
        if (!bot.audienceRestricted) return true;
        if (bot.audienceUserIds.includes(personId)) return true;
        return bot.userId === personId && bot.audienceUserIds.length === 0;
      })
      .map((bot) => bot.id),
  );
}

/**
 * In a partner's customer, the agents the person may see: their own copies and what is open to
 * all. Anywhere else every agent stays listed, as it always was.
 */
export async function onlyAgentsSeenBy<T extends { id: string }>(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  bots: readonly T[],
): Promise<T[]> {
  if (bots.length === 0) return [...bots];
  const sealed = await runAsSystem("partner customer agents", async () => {
    const tenant = await prisma.partnerTenant.findFirst({
      where: { organizationId: actor.spaceId },
      select: { id: true },
    });
    if (!tenant) return null;
    return prisma.bot.findMany({
      where: { spaceId: actor.spaceId, audienceRestricted: true },
      select: { id: true, userId: true, audienceRestricted: true, audienceUserIds: true },
    });
  });
  if (!sealed || sealed.length === 0) return [...bots];
  const seen = visibleAgentIds(sealed, actor.userId);
  const hidden = new Set(sealed.filter((bot) => !seen.has(bot.id)).map((bot) => bot.id));
  return bots.filter((bot) => !hidden.has(bot.id));
}
