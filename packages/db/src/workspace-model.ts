import type { PrismaClient } from "./client.js";
import { runAsTenant } from "./row-security.js";

/**
 * Whose model connections a member's work in a Space resolves. The owner can lend theirs to the
 * Space: a member then runs on the owner's connections (no key ever reaches the member) unless
 * they chose their own. Without a lent connection, or for the owner, it is the member's own.
 */
export type ModelScope = { userId: string; spaceId: string; delegated: boolean };

type ModelScopeClient = Pick<
  PrismaClient,
  "spaceModelConnection" | "spaceMember" | "spaceMemberModelSetting"
>;

export async function modelScope(
  prisma: ModelScopeClient,
  scope: { userId: string; spaceId?: string },
): Promise<ModelScope> {
  const own = { userId: scope.userId, spaceId: scope.spaceId ?? "", delegated: false };
  // Partial clients in tests, and callers with no Space, have nothing lent to them.
  if (!scope.spaceId || typeof prisma.spaceModelConnection?.findUnique !== "function") return own;
  const connection = await prisma.spaceModelConnection.findUnique({
    where: { spaceId: scope.spaceId },
    select: { ownerUserId: true },
  });
  if (!connection || connection.ownerUserId === scope.userId) return own;
  // Someone who is no longer in the Space gets nothing from it at once.
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
    select: { modelSetting: { select: { useOwnModel: true } } },
  });
  if (!member || member.modelSetting?.useOwnModel) return own;
  return { userId: connection.ownerUserId, spaceId: scope.spaceId, delegated: true };
}

/**
 * Runs `fn` with the scope whose connections apply. A lent connection belongs to the owner, so
 * `fn` runs as the owner for row-level security; keep it to model lookups.
 */
export async function withModelScope<T>(
  prisma: ModelScopeClient,
  scope: { userId: string; spaceId?: string },
  fn: (resolved: ModelScope) => Promise<T>,
): Promise<T> {
  const resolved = await modelScope(prisma, scope);
  return resolved.delegated
    ? runAsTenant({ spaceId: resolved.spaceId, userId: resolved.userId }, () => fn(resolved))
    : fn(resolved);
}

/** Tokens a member used in the Space since `since`, counted as `usageTokens` in @corvo/core does. */
export async function memberTokensSince(
  prisma: Pick<PrismaClient, "$queryRaw">,
  scope: { spaceId: string; userId: string },
  since: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ tokens: bigint | null }[]>`
    SELECT SUM(COALESCE("totalTokens", COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0))) AS tokens
    FROM usage_records
    WHERE "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId} AND "createdAt" >= ${since}`;
  return Number(rows[0]?.tokens ?? 0);
}

/** Every member's tokens in the Space since `since`. */
export async function spaceMemberTokensSince(
  prisma: Pick<PrismaClient, "$queryRaw">,
  spaceId: string,
  since: Date,
): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ userId: string; tokens: bigint | null }[]>`
    SELECT "userId", SUM(COALESCE("totalTokens", COALESCE("inputTokens", 0) + COALESCE("outputTokens", 0))) AS tokens
    FROM usage_records
    WHERE "spaceId" = ${spaceId} AND "createdAt" >= ${since}
    GROUP BY "userId"`;
  return new Map(rows.map((row) => [row.userId, Number(row.tokens ?? 0)]));
}

/** Lends the owner's connections to the Space, or takes them back. */
export async function setSpaceModelConnection(
  prisma: Pick<PrismaClient, "spaceModelConnection">,
  scope: { spaceId: string; userId: string },
  shared: boolean,
): Promise<void> {
  if (shared) {
    await prisma.spaceModelConnection.upsert({
      where: { spaceId: scope.spaceId },
      create: { spaceId: scope.spaceId, ownerUserId: scope.userId },
      update: { ownerUserId: scope.userId },
    });
    return;
  }
  await prisma.spaceModelConnection.deleteMany({ where: { spaceId: scope.spaceId } });
}

/** Saves what applies to one member on the lent connections; an omitted field keeps its value. */
export async function setMemberModelSetting(
  prisma: Pick<PrismaClient, "spaceMemberModelSetting">,
  scope: { spaceId: string; userId: string },
  patch: { useOwnModel?: boolean; monthlyTokenLimit?: number | null },
): Promise<void> {
  const data = {
    ...(patch.useOwnModel === undefined ? {} : { useOwnModel: patch.useOwnModel }),
    ...(patch.monthlyTokenLimit === undefined
      ? {}
      : {
          monthlyTokenLimit:
            patch.monthlyTokenLimit === null || patch.monthlyTokenLimit <= 0
              ? null
              : BigInt(patch.monthlyTokenLimit),
        }),
  };
  await prisma.spaceMemberModelSetting.upsert({
    where: { spaceId_userId: { spaceId: scope.spaceId, userId: scope.userId } },
    create: { spaceId: scope.spaceId, userId: scope.userId, ...data },
    update: data,
  });
}
