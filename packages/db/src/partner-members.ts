import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PartnerMember } from "@corvo/contracts";
import type { SpacePermission } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./generated/prisma/client.js";
import { runAsSystem } from "./row-security.js";
import { ensureDefaultSpaceRoles } from "./space-roles.js";

const newId = () => randomBytes(16).toString("hex");
const PARTNER_EMAIL_SUFFIX = "@partner.invalid";
/** Between Admin (0) and Everyone (the last): the role a partner's person holds. */
const MEMBER_ROLE_POSITION = 1;

/** Fixed per customer and person, so the same person always signs in as the same user. */
function memberDigest(tenantId: string, externalUserId: string): string {
  return createHash("sha256").update(`member\n${tenantId}\n${externalUserId}`).digest("hex");
}

export interface PartnerMemberInput {
  tenantId: string;
  organizationId: string;
  ownerUserId: string;
  externalUserId: string;
  externalEmail: string | null;
  /** Lower case; `owner` signs in as the customer's owner, anything else as a user of their own. */
  role: string;
  scope: Record<string, unknown> | null;
  /** The rights the role holds in the customer's space; ignored for the owner. */
  permissions: readonly SpacePermission[];
  /** What the person's own user is called; the partner's email or id when nothing better is known. */
  name?: string;
}

export interface AdmittedPartnerMember {
  /** Who the session opens. */
  userId: string;
  /** The role the person held on the partner's last session, null for a first visit. */
  previousRole: string | null;
  created: boolean;
}

/**
 * Records who the partner says this person is today, and makes the customer's space agree. The
 * owner opens the customer's own account; every other role gets a user of their own, a seat in
 * the space and exactly the rights of the role, so a change on the partner's side holds from the
 * next session. The same person always gets the same user. Call with a client that runs as the
 * system.
 */
export async function admitPartnerMember(
  prisma: PrismaClient,
  input: PartnerMemberInput,
): Promise<AdmittedPartnerMember> {
  const digest = memberDigest(input.tenantId, input.externalUserId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`;
    const existing = await tx.partnerTenantMember.findUnique({
      where: {
        tenantId_externalUserId: {
          tenantId: input.tenantId,
          externalUserId: input.externalUserId,
        },
      },
      select: { role: true },
    });
    const owner = input.role === "owner";
    const userId = owner
      ? input.ownerUserId
      : await ensureMemberUser(tx, input, digest, input.name ?? input.externalEmail);
    if (!owner) await holdRole(tx, input, userId);
    const scope = (input.scope ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull;
    await tx.partnerTenantMember.upsert({
      where: {
        tenantId_externalUserId: {
          tenantId: input.tenantId,
          externalUserId: input.externalUserId,
        },
      },
      create: {
        tenantId: input.tenantId,
        externalUserId: input.externalUserId,
        userId,
        externalEmail: input.externalEmail,
        role: input.role,
        scope,
      },
      update: {
        userId,
        externalEmail: input.externalEmail,
        role: input.role,
        scope,
      },
    });
    return { userId, previousRole: existing?.role ?? null, created: !existing };
  });
}

async function ensureMemberUser(
  tx: Prisma.TransactionClient,
  input: PartnerMemberInput,
  digest: string,
  name: string | null | undefined,
): Promise<string> {
  const email = `m-${digest.slice(0, 24)}${PARTNER_EMAIL_SUFFIX}`;
  const found = await tx.user.findUnique({ where: { email }, select: { id: true } });
  const userId = found?.id ?? newId();
  const now = new Date();
  if (!found) {
    await tx.user.create({
      data: {
        id: userId,
        name: (name ?? input.externalUserId).slice(0, 120),
        email,
        emailVerified: true,
      },
    });
  }
  await tx.member.upsert({
    where: { organizationId_userId: { organizationId: input.organizationId, userId } },
    create: {
      id: newId(),
      organizationId: input.organizationId,
      userId,
      role: "member",
      createdAt: now,
    },
    update: {},
  });
  await tx.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: input.organizationId, userId } },
    create: {
      id: newId(),
      spaceId: input.organizationId,
      organizationId: input.organizationId,
      userId,
      role: "member",
      createdAt: now,
    },
    update: {},
  });
  await tx.notificationPreference.upsert({
    where: { spaceId_userId: { spaceId: input.organizationId, userId } },
    create: { spaceId: input.organizationId, userId },
    update: {},
  });
  return userId;
}

/** The space's base role shrinks to talking, and the person holds exactly the role's rights. */
async function holdRole(
  tx: Prisma.TransactionClient,
  input: PartnerMemberInput,
  userId: string,
): Promise<void> {
  const spaceId = input.organizationId;
  await ensureDefaultSpaceRoles(tx, spaceId);
  await tx.spaceRole.updateMany({
    where: { spaceId, systemKey: "everyone" },
    data: { keys: ["talk_to_agents"] },
  });
  const keys = [...input.permissions];
  const found = await tx.spaceRole.findFirst({
    where: { spaceId, systemKey: null, name: input.role },
    select: { id: true },
  });
  const roleId = found?.id ?? randomUUID();
  if (found) await tx.spaceRole.update({ where: { id: roleId }, data: { keys } });
  else
    await tx.spaceRole.create({
      data: { id: roleId, spaceId, name: input.role, position: MEMBER_ROLE_POSITION, keys },
    });
  // One role at a time: the person's role is whatever the partner said last.
  await tx.spaceMemberRole.deleteMany({
    where: { spaceId, userId, NOT: { roleId } },
  });
  await tx.spaceMemberRole.upsert({
    where: { spaceId_userId_roleId: { spaceId, userId, roleId } },
    create: { spaceId, userId, roleId },
    update: {},
  });
}

/** What the partner last said about a person, from the user they are signed in as. */
export async function partnerMemberOf(
  prisma: PrismaClient,
  input: { spaceId: string; userId: string },
): Promise<{
  tenantId: string;
  externalUserId: string;
  role: string;
  scope: Record<string, unknown> | null;
} | null> {
  const row = await prisma.partnerTenantMember.findFirst({
    where: {
      userId: input.userId,
      tenant: { organizationId: input.spaceId },
    },
    orderBy: { updatedAt: "desc" },
    select: { tenantId: true, externalUserId: true, role: true, scope: true },
  });
  return row
    ? {
        tenantId: row.tenantId,
        externalUserId: row.externalUserId,
        role: row.role,
        scope: (row.scope as Record<string, unknown> | null) ?? null,
      }
    : null;
}

/** A customer's people for the partner console, most recent first. */
export async function listPartnerMembers(
  prisma: PrismaClient,
  tenantId: string,
): Promise<PartnerMember[]> {
  const rows = await prisma.partnerTenantMember.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({
    externalUserId: row.externalUserId,
    email: row.externalEmail,
    role: row.role,
    scope: (row.scope as Record<string, unknown> | null) ?? null,
    lastSeenAt: row.updatedAt.toISOString(),
  }));
}

/**
 * What the partner's connector is told about who is asking: their id in the partner's system,
 * role and scope, as headers. Nothing for a person the partner did not describe.
 */
export function partnerIdentityHeaders(
  prisma: PrismaClient,
): (person: { spaceId: string; userId: string }) => Promise<Record<string, string> | null> {
  return (person) =>
    runAsSystem("partner identity for the connector", async () => {
      const member = await partnerMemberOf(prisma, person);
      if (!member) return null;
      // Every owner of a customer signs in as the one owner account, so which of them is asking
      // cannot be told apart, and no id or scope is sent for them.
      if (member.role === "owner") return { "X-Rook-Role": "owner" };
      return {
        "X-Rook-User": member.externalUserId,
        "X-Rook-Role": member.role,
        ...(member.scope ? { "X-Rook-Scope": JSON.stringify(member.scope) } : {}),
      };
    });
}
