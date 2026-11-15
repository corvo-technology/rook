import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";

export class IsolationError extends Error {
  constructor(message = "Resource not found") {
    super(message);
    this.name = "IsolationError";
  }
}

/** Unique (spaceId, userId, name) collision when renaming a bot section. */
export class BotSectionNameConflictError extends Error {
  constructor(message = "Section name already used") {
    super(message);
    this.name = "BotSectionNameConflictError";
  }
}

export async function requireMembership(
  prisma: PrismaClient,
  userId: string,
  requestedSpaceId?: string | null,
): Promise<Actor> {
  const membership = await prisma.spaceMember.findFirst({
    where: {
      userId,
      ...(requestedSpaceId ? { spaceId: requestedSpaceId } : {}),
    },
    orderBy: [{ space: { isDefault: "desc" } }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      userId: true,
      spaceId: true,
      member: { select: { user: { select: { email: true } } } },
    },
  });
  if (!membership) {
    throw new IsolationError("No personal space");
  }
  return {
    userId: membership.userId,
    spaceId: membership.spaceId,
    email: membership.member.user.email,
    isDeploymentOwner: false,
  };
}

export function scoped<T extends { spaceId: string; userId?: string }>(
  actor: Actor,
  record: T | null,
  options: { shared?: boolean } = {},
): T {
  if (!record || record.spaceId !== actor.spaceId) {
    throw new IsolationError();
  }
  // Shared content is the space's; `userId` is only who created it.
  if (!options.shared && record.userId && record.userId !== actor.userId) {
    throw new IsolationError();
  }
  return record;
}

/**
 * Where-clause for content the whole space shares (agents, channels, conversations, boards,
 * wiki, files). The row's `userId` stays "created by" and is never part of the filter.
 */
export function sharedWhere(actor: Pick<Actor, "spaceId">): { spaceId: string } {
  return { spaceId: actor.spaceId };
}

/** The actor's membership in the space it acts in, or null when it is not a member. */
export async function getActorSpaceMembership(
  prisma: Pick<PrismaClient, "spaceMember">,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<{ role: string } | null> {
  return prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: { role: true },
  });
}

/** Fails closed unless the actor is a member of the space it acts in. */
export async function requireSpaceMember(
  prisma: Pick<PrismaClient, "spaceMember">,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<{ role: string }> {
  const membership = await getActorSpaceMembership(prisma, actor);
  if (!membership) throw new IsolationError();
  return membership;
}

/** Spaces of `spaceIds` the user belongs to; shared lists only ever span these. */
export async function memberSpaceIds(
  prisma: Pick<PrismaClient, "spaceMember">,
  userId: string,
  spaceIds: string[],
): Promise<string[]> {
  if (spaceIds.length === 0) return [];
  const rows = await prisma.spaceMember.findMany({
    where: { userId, spaceId: { in: spaceIds } },
    select: { spaceId: true },
  });
  return rows.map((row) => row.spaceId);
}
