import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { IsolationError } from "./scope.js";

/** Who is looking at the space's channels, as the channel filter reads them. */
export interface GroupViewer {
  userId: string;
  /** The custom roles the person holds in the channel's space. */
  roleIds: readonly string[];
  /** Holders of `manage_channels` (owners and admins by default) see every channel. */
  seesAll: boolean;
}

/**
 * A channel with no people rows and no granted roles is open: every member of the space sees it.
 * Adding people or roles makes it private to them, to the holders of those roles, to the member
 * who created it and to whoever holds `manage_channels`. This is the one place that says who sees
 * a channel, so every read of channels, and of anything inside one, shares it.
 */
export function channelVisibleTo(viewer: GroupViewer): Prisma.ChatGroupWhereInput {
  if (viewer.seesAll) return {};
  return {
    OR: [
      { userId: viewer.userId },
      { people: { none: {} }, accessRoleIds: { isEmpty: true } },
      { people: { some: { userId: viewer.userId } } },
      ...(viewer.roleIds.length ? [{ accessRoleIds: { hasSome: [...viewer.roleIds] } }] : []),
    ],
  };
}

/**
 * The same rule for raw queries over `chat_groups AS alias`; the alias is a fixed identifier. Given
 * only a user id it reads their roles from the database (for counts across spaces); given a
 * viewer it uses the roles already loaded.
 */
export function channelVisibleToSql(alias: "g", viewer: GroupViewer | string): Prisma.Sql {
  const group = Prisma.raw(alias);
  const userId = typeof viewer === "string" ? viewer : viewer.userId;
  if (typeof viewer !== "string" && viewer.seesAll) return Prisma.sql`TRUE`;
  const roles =
    typeof viewer === "string"
      ? Prisma.sql`EXISTS (SELECT 1 FROM space_member_roles r WHERE r."spaceId" = ${group}."spaceId"
          AND r."userId" = ${userId} AND r."roleId" = ANY(${group}."accessRoleIds"))`
      : Prisma.sql`${group}."accessRoleIds" && ${[...viewer.roleIds]}::text[]`;
  return Prisma.sql`(
    ${group}."userId" = ${userId}
    OR (cardinality(${group}."accessRoleIds") = 0
      AND NOT EXISTS (SELECT 1 FROM chat_group_people p WHERE p."groupId" = ${group}.id))
    OR EXISTS (SELECT 1 FROM chat_group_people p WHERE p."groupId" = ${group}.id AND p."userId" = ${userId})
    OR ${roles}
  )`;
}

/** The in-memory form of `channelVisibleTo`, for a channel row already in hand. */
export function groupVisibleTo(
  viewer: GroupViewer,
  group: { userId: string; peopleIds: readonly string[]; accessRoleIds: readonly string[] },
): boolean {
  return (
    viewer.seesAll ||
    group.userId === viewer.userId ||
    (group.peopleIds.length === 0 && group.accessRoleIds.length === 0) ||
    group.peopleIds.includes(viewer.userId) ||
    viewer.roleIds.some((roleId) => group.accessRoleIds.includes(roleId))
  );
}

export interface ChannelPeople {
  /** False when every member of the space sees the channel. */
  restricted: boolean;
  userIds: string[];
  /** The roles whose holders see the channel. */
  roleIds: string[];
}

type Db = Pick<PrismaClient, "chatGroup" | "chatGroupPerson" | "spaceMember">;

/** Who sees the channel. Open channels list no one: it is the whole space. */
export async function listChannelPeople(
  db: Db,
  input: { spaceId: string; groupId: string },
): Promise<ChannelPeople> {
  const group = await db.chatGroup.findFirst({
    where: { id: input.groupId, spaceId: input.spaceId },
    select: {
      userId: true,
      accessRoleIds: true,
      people: { select: { userId: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!group) throw new IsolationError();
  if (group.people.length === 0 && group.accessRoleIds.length === 0) {
    return { restricted: false, userIds: [], roleIds: [] };
  }
  return {
    restricted: true,
    userIds: group.people.length
      ? [...new Set([group.userId, ...group.people.map((row) => row.userId)])]
      : [],
    roleIds: group.accessRoleIds,
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

/**
 * Grants a channel to the holders of these roles, making it private to them and to its people
 * when it was open. An empty list takes the grants back. Only this space's roles can be named.
 */
export async function setChannelRoles(
  prisma: PrismaClient,
  input: { spaceId: string; groupId: string; roleIds: string[] },
): Promise<void> {
  const roles = input.roleIds.length
    ? await prisma.spaceRole.findMany({
        where: { spaceId: input.spaceId, id: { in: input.roleIds }, systemKey: null },
        select: { id: true },
      })
    : [];
  const result = await prisma.chatGroup.updateMany({
    where: { id: input.groupId, spaceId: input.spaceId },
    data: { accessRoleIds: roles.map((role) => role.id) },
  });
  if (result.count !== 1) throw new IsolationError();
}

/** Opens a private channel to the whole space again: no people and no roles. */
export async function openChannelToSpace(
  prisma: PrismaClient,
  input: { spaceId: string; groupId: string },
): Promise<void> {
  await prisma.$transaction([
    prisma.chatGroupPerson.deleteMany({
      where: { groupId: input.groupId, spaceId: input.spaceId },
    }),
    prisma.chatGroup.updateMany({
      where: { id: input.groupId, spaceId: input.spaceId },
      data: { accessRoleIds: [] },
    }),
  ]);
}
