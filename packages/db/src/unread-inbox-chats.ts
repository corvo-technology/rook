import { GROUP_MEMBER_MIN } from "@corvo/contracts";
import { channelVisibleToSql } from "./channel-people.js";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/** Counts the chats the user has not read in their member Spaces within the current organization. */
export function countUnreadInboxChats(
  prisma: PrismaClient,
  { userId, spaceId }: { userId: string; spaceId: string },
): Promise<number> {
  // Cross-Space RLS bypass is restricted to this user's memberships and their own read state.
  return runAsSystem("count unread inbox chats across the member's Spaces", async () => {
    const [result] = await prisma.$queryRaw<Array<{ count: number }>>`
      WITH member_spaces AS (
        SELECT m."spaceId" FROM space_members m
        JOIN spaces s ON s.id = ${spaceId} AND s."organizationId" = m."organizationId"
        WHERE m."userId" = ${userId}
      )
      SELECT count(*)::int AS count FROM threads t
      JOIN member_spaces m ON m."spaceId" = t."spaceId"
      WHERE (
          (t."userId" = ${userId} AND t.unread)
          OR EXISTS (SELECT 1 FROM thread_member_reads r
            WHERE r."threadId" = t.id AND r."userId" = ${userId} AND r.unread)
        )
        AND t."externalConversationId" IS NULL
        AND (
          EXISTS (SELECT 1 FROM bots b WHERE b.id = t."botId"
            AND b."spaceId" = t."spaceId" AND b."archivedAt" IS NULL
            AND (NOT b."audienceRestricted" OR b."userId" = ${userId}
              OR ${userId} = ANY(b."audienceUserIds")
              OR EXISTS (SELECT 1 FROM space_member_roles r WHERE r."spaceId" = b."spaceId"
                AND r."userId" = ${userId} AND r."roleId" = ANY(b."audienceRoleIds"))))
          OR EXISTS (SELECT 1 FROM chat_groups g WHERE g.id = t."groupId"
            AND g."spaceId" = t."spaceId" AND g."archivedAt" IS NULL
            AND ${channelVisibleToSql("g", userId)}
            AND (SELECT count(*) FROM chat_group_members gm JOIN bots b ON b.id = gm."botId"
              WHERE gm."groupId" = g.id AND b."archivedAt" IS NULL) >= ${GROUP_MEMBER_MIN})
        )`;
    return result?.count ?? 0;
  });
}
