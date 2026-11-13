import type { Actor } from "@corvo/contracts";
import type { SpacePermission } from "@corvo/core";
import { can } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { ORPCError } from "@orpc/server";

/** Refuses anyone whose role in the Space the actor is acting in lacks the permission. */
export async function requireSpacePermission(
  prisma: PrismaClient,
  actor: Actor,
  permission: SpacePermission,
): Promise<void> {
  const membership = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: actor.spaceId, userId: actor.userId } },
    select: { role: true },
  });
  if (!can(membership, permission)) throw new ORPCError("FORBIDDEN");
}

/** Refuses anyone who is not an owner of the Space the actor is acting in. */
export const requireSpaceOwner = (prisma: PrismaClient, actor: Actor): Promise<void> =>
  requireSpacePermission(prisma, actor, "manage_owners");
