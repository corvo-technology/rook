import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { IsolationError } from "./scope.js";

/**
 * A channel with no people rows is open: every member of the space sees it. Adding people makes
 * it private to them and to the member who created it. This is the one place that says who sees a
 * channel, so every read of channels shares it.
 */
export function channelVisibleTo(userId: string): Prisma.ChatGroupWhereInput {
  return { OR: [{ userId }, { people: { none: {} } }, { people: { some: { userId } } }] };
}

/** The same rule for raw queries over `chat_groups AS alias`; the alias is a fixed identifier. */
export function channelVisibleToSql(alias: "g", userId: string): Prisma.Sql {
  const group = Prisma.raw(alias);
  return Prisma.sql`(
    ${group}."userId" = ${userId}
    OR NOT EXISTS (SELECT 1 FROM chat_group_people p WHERE p."groupId" = ${group}.id)
    OR EXISTS (SELECT 1 FROM chat_group_people p WHERE p."groupId" = ${group}.id AND p."userId" = ${userId})
  )`;
}

export interface ChannelPeople {
  /** False when every member of the space sees the channel. */
  restricted: boolean;
  userIds: string[];
}

type Db = Pick<PrismaClient, "chatGroup" | "chatGroupPerson" | "spaceMember">;

/** Who sees the channel. Open channels list no one: it is the whole space. */
export async function listChannelPeople(
  db: Db,
  input: { spaceId: string; groupId: string },
): Promise<ChannelPeople> {
  const group = await db.chatGroup.findFirst({
    where: { id: input.groupId, spaceId: input.spaceId },
    select: { userId: true, people: { select: { userId: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!group) throw new IsolationError();
  if (group.people.length === 0) return { restricted: false, userIds: [] };
  return {
    restricted: true,
    userIds: [...new Set([group.userId, ...group.people.map((row) => row.userId)])],
  };
}

/**
 * Adds people to a channel, making it private when it was open. The first time, the channel's
 * creator is kept: they made it. Only members of the space can be added.
 */
export async function addChannelPeople(
  prisma: PrismaClient,
  input: { spaceId: string; groupId: string; actorId: string; userIds: string[] },
): Promise<void> {
  const userIds = [...new Set(input.userIds)];
  await prisma.$transaction(async (tx) => {
    const group = await tx.chatGroup.findFirst({
      where: { id: input.groupId, spaceId: input.spaceId },
      select: { userId: true },
    });
    if (!group) throw new IsolationError();
    const members = await tx.spaceMember.findMany({
      where: { spaceId: input.spaceId, userId: { in: [...userIds, group.userId] } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((row) => row.userId));
    if (!userIds.every((id) => memberIds.has(id))) throw new IsolationError();
    // A creator who left the space no longer sees what they made.
    const everyone = memberIds.has(group.userId) ? [group.userId, ...userIds] : userIds;
    await tx.chatGroupPerson.createMany({
      data: [...new Set(everyone)].map((userId) => ({
        groupId: input.groupId,
        spaceId: input.spaceId,
        userId,
        addedByUserId: input.actorId,
      })),
      skipDuplicates: true,
    });
  });
}

/** Takes a person off a private channel. The creator stays: removing them would hide it from its maker. */
export async function removeChannelPerson(
  prisma: PrismaClient,
  input: { spaceId: string; groupId: string; userId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const group = await tx.chatGroup.findFirst({
      where: { id: input.groupId, spaceId: input.spaceId },
      select: { userId: true },
    });
    if (!group) throw new IsolationError();
    if (group.userId === input.userId) throw new IsolationError();
    await tx.chatGroupPerson.deleteMany({
      where: { groupId: input.groupId, spaceId: input.spaceId, userId: input.userId },
    });
  });
}

/** Opens a private channel to the whole space again. */
export async function openChannelToSpace(
  prisma: PrismaClient,
  input: { spaceId: string; groupId: string },
): Promise<void> {
  await prisma.chatGroupPerson.deleteMany({
    where: { groupId: input.groupId, spaceId: input.spaceId },
  });
}
