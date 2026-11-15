import type { Actor } from "@corvo/contracts";
import type { SpacePermission } from "@corvo/core";
import { can as canToday } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getActorSpaceMembership } from "@corvo/db";
import { ORPCError } from "@orpc/server";

/**
 * Permission keys for work on shared content. Local adapter over today's fixed role table,
 * named like the roles contract (`can`, `getSpaceMembership`, `requireSpacePermission`) so it
 * can be swapped for it by changing this one import.
 */
export type SharedSpaceKey =
  | "talk_to_agents"
  | "manage_agents"
  | "create_agents"
  | "manage_routines"
  | "approve_actions"
  | "manage_channels"
  | "create_channels"
  | "edit_wiki"
  | "upload_files"
  | "manage_connections";

/**
 * Keys every member holds, as the roles branch's default "Everyone" role does; the rest follow
 * the admin role until that branch's resolver replaces this adapter.
 */
const OPEN_TO_MEMBERS: ReadonlySet<SharedSpaceKey> = new Set([
  "talk_to_agents",
  "create_agents",
  "create_channels",
  "edit_wiki",
  "upload_files",
]);

const TODAY: Record<
  Exclude<
    SharedSpaceKey,
    "talk_to_agents" | "create_agents" | "create_channels" | "edit_wiki" | "upload_files"
  >,
  SpacePermission
> = {
  manage_agents: "manage_agents",
  manage_routines: "manage_agents",
  approve_actions: "manage_agents",
  manage_channels: "manage_agents",
  manage_connections: "manage_settings",
};

export function can(
  membership: { role: string | null | undefined } | null | undefined,
  key: SharedSpaceKey,
): boolean {
  if (!membership) return false;
  if (OPEN_TO_MEMBERS.has(key)) return true;
  return canToday(membership, TODAY[key as keyof typeof TODAY]);
}

export function getSpaceMembership(db: Pick<PrismaClient, "spaceMember">, actor: Actor) {
  return getActorSpaceMembership(db, actor);
}

/** Refuses anyone who is not a member of the actor's space or lacks the key. */
export async function requireSpacePermission(
  db: Pick<PrismaClient, "spaceMember">,
  actor: Actor,
  key: SharedSpaceKey,
): Promise<{ role: string }> {
  const membership = await getSpaceMembership(db, actor);
  if (!membership || !can(membership, key)) throw new ORPCError("FORBIDDEN");
  return membership;
}

/** Whoever created the thing, or anyone holding the key, may change it. */
export async function requireCreatorOrPermission(
  db: Pick<PrismaClient, "spaceMember">,
  actor: Actor,
  createdBy: string,
  key: SharedSpaceKey,
): Promise<void> {
  if (createdBy === actor.userId) {
    if (await getSpaceMembership(db, actor)) return;
    throw new ORPCError("FORBIDDEN");
  }
  await requireSpacePermission(db, actor, key);
}
