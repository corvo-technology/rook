import type { PrismaClient } from "./client.js";

type Db = Pick<PrismaClient, "chatGroup" | "bot" | "spaceMember" | "spaceMemberRole">;

async function spaceMemberIds(db: Pick<Db, "spaceMember">, spaceId: string): Promise<string[]> {
  const rows = await db.spaceMember.findMany({ where: { spaceId }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

async function roleHolderIds(
  db: Pick<Db, "spaceMemberRole">,
  spaceId: string,
  roleIds: readonly string[],
): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await db.spaceMemberRole.findMany({
    where: { spaceId, roleId: { in: [...roleIds] } },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

/**
 * The members who certainly see a channel: everyone while it is open, otherwise its creator,
 * the people added and the holders of the granted roles. Members who see it only because they
 * manage channels are left out, so a mention never reaches someone by guesswork.
 */
export async function channelAudienceUserIds(
  db: Db,
  spaceId: string,
  groupId: string,
): Promise<string[]> {
  const group = await db.chatGroup.findFirst({
    where: { id: groupId, spaceId },
    select: { userId: true, accessRoleIds: true, people: { select: { userId: true } } },
  });
  if (!group) return [];
  if (group.people.length === 0 && group.accessRoleIds.length === 0) {
    return spaceMemberIds(db, spaceId);
  }
  const holders = await roleHolderIds(db, spaceId, group.accessRoleIds);
  return [...new Set([group.userId, ...group.people.map((row) => row.userId), ...holders])];
}

/**
 * The members who read an agent's conversation: everyone while the agent is unrestricted,
 * otherwise its owner, the people named and the holders of the named roles.
 */
export async function agentAudienceUserIds(
  db: Db,
  spaceId: string,
  botId: string,
): Promise<string[]> {
  const bot = await db.bot.findFirst({
    where: { id: botId, spaceId },
    select: {
      userId: true,
      audienceRestricted: true,
      audienceRoleIds: true,
      audienceUserIds: true,
    },
  });
  if (!bot) return [];
  if (!bot.audienceRestricted) return spaceMemberIds(db, spaceId);
  const holders = await roleHolderIds(db, spaceId, bot.audienceRoleIds);
  return [...new Set([bot.userId, ...bot.audienceUserIds, ...holders])];
}

/** Who can see one conversation, so a person can be named in it. Always members of the space. */
export async function conversationAudienceUserIds(
  db: Db,
  spaceId: string,
  target: { groupId?: string | null; botId?: string | null },
): Promise<string[]> {
  const ids = target.groupId
    ? await channelAudienceUserIds(db, spaceId, target.groupId)
    : target.botId
      ? await agentAudienceUserIds(db, spaceId, target.botId)
      : [];
  if (ids.length === 0) return [];
  const members = new Set(await spaceMemberIds(db, spaceId));
  return ids.filter((id) => members.has(id));
}
