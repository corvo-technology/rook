import type { Actor } from "@corvo/contracts";
import { can } from "@corvo/core";
import type { Prisma, PrismaClient } from "@corvo/db";
import { IsolationError } from "@corvo/db";
import { getSpaceMembership } from "./space-owner.js";

type ActorRef = Pick<Actor, "spaceId" | "userId">;

/** Whether the actor manages the space's connections. A failed lookup is "no", never "yes". */
export async function managesConnections(prisma: PrismaClient, actor: ActorRef): Promise<boolean> {
  try {
    return can(await getSpaceMembership(prisma, actor), "manage_connections");
  } catch {
    return false;
  }
}

/** Whose a connection or server is, for the screens that show more than the actor's own. */
export type ConnectionOwner = { userId: string; name: string; mine: boolean };

/**
 * A space's connections are the accounts its agents act with: those of the people who own agents
 * there. A connection of someone who owns none is personal and is never listed to others.
 */
async function agentOwnerIds(prisma: PrismaClient, spaceId: string): Promise<string[]> {
  const rows = await prisma.bot.findMany({
    where: { spaceId, archivedAt: null },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((row) => row.userId);
}

/**
 * Connections the actor reaches: their own, plus the space's for anyone holding
 * `manage_connections`. A list that asks only for "mine" passes `listing: false`.
 */
export async function connectionsWhere(
  prisma: PrismaClient,
  actor: ActorRef,
  options: { listing?: boolean } = {},
): Promise<Prisma.ConnectionWhereInput> {
  const manages = await managesConnections(prisma, actor);
  if (!manages || options.listing === false)
    return { spaceId: actor.spaceId, userId: actor.userId };
  return {
    spaceId: actor.spaceId,
    OR: [{ userId: actor.userId }, { userId: { in: await agentOwnerIds(prisma, actor.spaceId) } }],
  };
}

/** MCP servers the actor sees: their own, plus those assigned to the space's agents for a manager. */
export async function mcpServersWhere(
  prisma: PrismaClient,
  actor: ActorRef,
  options: { listing?: boolean } = {},
): Promise<Prisma.McpServerWhereInput> {
  const manages = await managesConnections(prisma, actor);
  if (!manages || options.listing === false)
    return { spaceId: actor.spaceId, userId: actor.userId };
  return {
    spaceId: actor.spaceId,
    OR: [
      { userId: actor.userId },
      { assignments: { some: { spaceId: actor.spaceId, bot: { archivedAt: null } } } },
    ],
  };
}

export async function connectionOwners(
  prisma: PrismaClient,
  actor: ActorRef,
  userIds: readonly string[],
): Promise<Map<string, ConnectionOwner>> {
  const ids = [...new Set(userIds)];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  return new Map(
    users.map((user) => [
      user.id,
      { userId: user.id, name: user.name, mine: user.id === actor.userId },
    ]),
  );
}

/**
 * The actor, acting as the owner of a connection or server they may manage. Provider calls and
 * encrypted material are bound to the owner, so a manager acts with the owner's identity for that
 * one row and nothing else.
 */
export function actingAsOwnerOf(actor: Actor, row: { userId: string } | null): Actor {
  if (!row) throw new IsolationError();
  return row.userId === actor.userId ? actor : { ...actor, userId: row.userId };
}

/**
 * The same actor for anyone who does not manage connections, who only ever reaches their own rows;
 * for a manager, the owner of the one connection or server `lookup` finds.
 */
export async function actorForManaged(
  prisma: PrismaClient,
  actor: Actor,
  lookup: () => Promise<{ userId: string } | null>,
): Promise<Actor> {
  if (!(await managesConnections(prisma, actor))) return actor;
  const row = await lookup();
  return row ? actingAsOwnerOf(actor, row) : actor;
}
