import type { SecretStore } from "@corvo/adapter-kit";
import {
  deleteVaultSecret,
  listVaultCredentials,
  listVaultSecretUses,
  loadVaultCredential,
  normalizeSecretDestination,
  pageUrlOrigin,
  replaceVaultSecretValue,
  setVaultSecretAgents,
  storeVaultSecret,
  vaultRowBotIds,
} from "@corvo/adapters";
import type { Actor, VaultCreateInput, VaultCredential, VaultUse } from "@corvo/contracts";
import { BotSecretAuth, VaultCreateInput as VaultCreateSchema } from "@corvo/contracts";
import type { SpaceMembership } from "@corvo/core";
import { can } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { runAsSystem } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { mapBotSecretStoreError } from "./routes/bots.js";
import { getSpaceMembership } from "./space-owner.js";

type Scope = Pick<Actor, "spaceId" | "userId">;
type Row = Awaited<ReturnType<typeof listVaultCredentials>>[number];

export interface VaultServiceDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
}

/**
 * Personal credentials are managed by their owner. Space credentials belong to the space, so they
 * are managed by whoever holds the credentials key (owners and administrators included).
 */
function mayManage(
  row: Pick<Row, "scope" | "userId">,
  actor: Scope,
  membership: SpaceMembership | null,
) {
  return row.scope === "space"
    ? can(membership, "manage_credentials")
    : row.userId === actor.userId;
}

function toDto(row: Row, actor: Scope, membership: SpaceMembership | null): VaultCredential {
  // Unreadable or no-longer-storable settings become auth:null so the row stays remove-only.
  const parsed = BotSecretAuth.safeParse(row.auth);
  let auth: VaultCredential["auth"] = null;
  if (parsed.success) {
    try {
      normalizeSecretDestination({ name: row.name, origin: row.origin, auth: parsed.data });
      auth = parsed.data;
    } catch {
      /* Left unreadable. */
    }
  }
  return {
    id: row.id,
    name: row.name,
    origin: row.origin,
    auth,
    scope: row.scope === "space" ? "space" : "personal",
    mine: row.userId === actor.userId,
    canManage: mayManage(row, actor, membership),
    botIds: vaultRowBotIds(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export function createVaultService(deps: VaultServiceDeps) {
  const { prisma, secrets } = deps;

  /** Agents of this space only; nothing else can be granted a credential. */
  async function requireSpaceAgents(scope: Scope, botIds: string[]): Promise<string[]> {
    const wanted = [...new Set(botIds)];
    if (!wanted.length) return wanted;
    const bots = await prisma.bot.findMany({
      where: { id: { in: wanted }, spaceId: scope.spaceId, archivedAt: null },
      select: { id: true },
    });
    if (bots.length !== wanted.length) throw new ORPCError("FORBIDDEN");
    return wanted;
  }

  async function load(scope: Scope, id: string) {
    const row = await loadVaultCredential(prisma, scope, id);
    if (!row) throw new ORPCError("NOT_FOUND");
    return row;
  }

  async function dto(scope: Scope, id: string, membership: SpaceMembership | null) {
    const rows = await listVaultCredentials(prisma, scope);
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) throw new ORPCError("NOT_FOUND");
    return toDto(row, scope, membership);
  }

  return {
    async list(scope: Scope): Promise<VaultCredential[]> {
      const membership = await getSpaceMembership(prisma, scope);
      if (!membership) throw new ORPCError("FORBIDDEN");
      const rows = await listVaultCredentials(prisma, scope);
      return rows.map((row) => toDto(row, scope, membership));
    },

    async create(scope: Scope, raw: VaultCreateInput): Promise<VaultCredential> {
      const input = VaultCreateSchema.parse(raw);
      const membership = await getSpaceMembership(prisma, scope);
      if (!membership) throw new ORPCError("FORBIDDEN");
      // A team credential is the space's: only someone who may manage them creates one.
      if (input.scope === "space" && !can(membership, "manage_credentials")) {
        throw new ORPCError("FORBIDDEN");
      }
      const botIds = await requireSpaceAgents(scope, input.botIds);
      // A pasted page URL is saved under its site. One with a username or password is left
      // as typed, so the origin rule turns it down and the person can fix it.
      const site = pageUrlOrigin(input.destination.origin, {
        allowUserinfo: false,
        maxLength: 2048,
      });
      let id: string;
      try {
        id = await storeVaultSecret({
          prisma,
          secretStore: secrets,
          person: scope,
          destination: site ? { ...input.destination, origin: site } : input.destination,
          plaintext: input.value,
          visibility: input.scope,
          botIds,
        });
      } catch (error) {
        throw mapBotSecretStoreError(error);
      }
      return dto(scope, id, membership);
    },

    async replace(scope: Scope, id: string, value: string): Promise<VaultCredential> {
      const membership = await getSpaceMembership(prisma, scope);
      const row = await load(scope, id);
      if (!mayManage(row, scope, membership)) throw new ORPCError("FORBIDDEN");
      try {
        await replaceVaultSecretValue({ prisma, secretStore: secrets, row, plaintext: value });
      } catch (error) {
        throw mapBotSecretStoreError(error);
      }
      return dto(scope, id, membership);
    },

    async setAgents(scope: Scope, id: string, botIds: string[]): Promise<VaultCredential> {
      const membership = await getSpaceMembership(prisma, scope);
      const row = await load(scope, id);
      if (!mayManage(row, scope, membership)) throw new ORPCError("FORBIDDEN");
      const wanted = await requireSpaceAgents(scope, botIds);
      try {
        await setVaultSecretAgents(prisma, row, wanted);
      } catch (error) {
        throw mapBotSecretStoreError(error);
      }
      return dto(scope, id, membership);
    },

    async remove(scope: Scope, id: string): Promise<void> {
      const membership = await getSpaceMembership(prisma, scope);
      const row = await loadVaultCredential(prisma, scope, id);
      if (!row) return;
      if (!mayManage(row, scope, membership)) throw new ORPCError("FORBIDDEN");
      await deleteVaultSecret(prisma, id);
    },

    async uses(scope: Scope, id: string): Promise<VaultUse[]> {
      const membership = await getSpaceMembership(prisma, scope);
      const row = await load(scope, id);
      // Who used a team credential, and for whom, is for those who manage it.
      if (!mayManage(row, scope, membership)) throw new ORPCError("FORBIDDEN");
      const uses = await listVaultSecretUses(prisma, id);
      const userIds = [...new Set(uses.flatMap((use) => (use.forUserId ? [use.forUserId] : [])))];
      const users = userIds.length
        ? await runAsSystem("name the people a credential was used for", () =>
            prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true },
            }),
          )
        : [];
      const names = new Map(users.map((user) => [user.id, user.name]));
      return uses.map((use) => ({
        id: use.id,
        botId: use.botId,
        runId: use.runId,
        forName: use.forUserId ? (names.get(use.forUserId) ?? null) : null,
        forMe: use.forUserId === scope.userId,
        destination: use.destination,
        outcome: use.outcome === "ok" ? "ok" : "failed",
        createdAt: use.createdAt.toISOString(),
      }));
    },
  };
}
