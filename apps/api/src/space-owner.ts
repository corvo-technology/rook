import type { Actor } from "@corvo/contracts";
import type { SpaceMembership, SpacePermission } from "@corvo/core";
import { can } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getSpaceMembershipFor, runAsSystem } from "@corvo/db";
import { ORPCError } from "@orpc/server";

/**
 * What the actor may do in the space they are acting in: their resolved keys, whether they own
 * it, and the roles they hold. Null for someone who is not a member.
 */
export function getSpaceMembership(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<SpaceMembership | null> {
  return runAsSystem("read a member's roles in their space", () =>
    getSpaceMembershipFor(prisma, { spaceId: actor.spaceId, userId: actor.userId }),
  );
}

/** Refuses anyone whose roles in the space the actor is acting in lack the key. */
export async function requireSpacePermission(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  key: SpacePermission,
): Promise<void> {
  if (!can(await getSpaceMembership(prisma, actor), key)) throw new ORPCError("FORBIDDEN");
}

/** Refuses anyone who is not an owner of the space the actor is acting in. Ownership is not a role. */
export async function requireSpaceOwner(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<void> {
  if (!(await getSpaceMembership(prisma, actor))?.isOwner) throw new ORPCError("FORBIDDEN");
}

/** Whoever created the thing, or anyone holding the key, may change it. */
export async function requireCreatorOrPermission(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
  createdBy: string,
  key: SpacePermission,
): Promise<void> {
  const membership = await getSpaceMembership(prisma, actor);
  // A creator who left the space no longer changes anything.
  if (!membership) throw new ORPCError("FORBIDDEN");
  if (createdBy === actor.userId) return;
  if (!can(membership, key)) throw new ORPCError("FORBIDDEN");
}
