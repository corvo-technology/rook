import { UNREAD_COUNT_CAP } from "@corvo/contracts";
import type { Prisma, PrismaClient } from "./client.js";

/**
 * Unread state is per member. The thread's creator keeps using the `unread` and `lastReadSeq`
 * columns on the thread; every other member has a `thread_member_reads` row, created the first
 * time something lands that they have not seen. A member without a row has read everything.
 */
type ReadClient = Pick<PrismaClient, "threadMemberRead">;

/** The unread flag each member sees, for threads loaded together. */
export async function memberUnreadByThread(
  prisma: ReadClient,
  userId: string,
  threads: ReadonlyArray<{ id: string; userId: string; unread: boolean }>,
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const others = threads.filter((thread) => thread.userId !== userId);
  for (const thread of threads) {
    if (thread.userId === userId) result.set(thread.id, thread.unread);
  }
  if (others.length > 0) {
    const rows = await prisma.threadMemberRead.findMany({
      where: { userId, threadId: { in: others.map((thread) => thread.id) } },
      select: { threadId: true, unread: true },
    });
    const byThread = new Map(rows.map((row) => [row.threadId, row.unread]));
    for (const thread of others) result.set(thread.id, byThread.get(thread.id) ?? false);
  }
  return result;
}

/**
 * Marks a new message unread for every member but the thread's creator, whose flag is on the
 * thread. The author of the message, when known, is skipped: they have just seen it.
 */
export async function markUnreadForOtherMembers(
  tx: Prisma.TransactionClient,
  input: { threadId: string; seq: number; exceptUserId?: string },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO thread_member_reads ("threadId", "spaceId", "userId", "unread", "lastReadSeq", "updatedAt")
    SELECT t.id, t."spaceId", m."userId", true, ${input.seq - 1}::int, now()
    FROM threads t
    JOIN space_members m ON m."spaceId" = t."spaceId"
    WHERE t.id = ${input.threadId}
      AND m."userId" <> t."userId"
      AND m."userId" IS DISTINCT FROM ${input.exceptUserId ?? null}::text
    ON CONFLICT ("threadId", "userId")
    DO UPDATE SET "unread" = true, "updatedAt" = now()`;
}

export interface UnreadCounts {
  /** Messages the member has not read, at most UNREAD_COUNT_CAP. */
  count: number;
  /** Unread entries that name the member. */
  mentions: number;
}

/**
 * How many messages wait in each of these conversations for this member, and how many of the
 * entries name them. Only conversations the caller found unread are counted, each capped, so the
 * work follows what is unread and never the length of a history. The member's own messages, and a
 * creator's own unattributed ones, never count.
 */
export async function memberUnreadCounts(
  prisma: Pick<PrismaClient, "$queryRaw" | "notification">,
  userId: string,
  threadIds: readonly string[],
): Promise<Map<string, UnreadCounts>> {
  const result = new Map<string, UnreadCounts>();
  if (threadIds.length === 0) return result;
  const [counts, mentions] = await Promise.all([
    prisma.$queryRaw<Array<{ threadId: string; count: number }>>`
      SELECT t.id AS "threadId", (
        SELECT count(*)::int FROM (
          SELECT 1 FROM messages m
          WHERE m."threadId" = t.id
            AND m.seq > COALESCE(r."lastReadSeq",
              CASE WHEN t."userId" = ${userId} THEN t."lastReadSeq" ELSE -1 END)
            AND m.role IN ('user', 'bot')
            AND m."authorUserId" IS DISTINCT FROM ${userId}
            AND NOT (t."userId" = ${userId} AND m.role = 'user' AND m."authorUserId" IS NULL)
          LIMIT ${UNREAD_COUNT_CAP}
        ) capped
      ) AS count
      FROM threads t
      LEFT JOIN thread_member_reads r ON r."threadId" = t.id AND r."userId" = ${userId}
      WHERE t.id = ANY(${[...threadIds]}::text[])`,
    prisma.notification.groupBy({
      by: ["threadId"],
      where: { userId, kind: "mention", readAt: null, threadId: { in: [...threadIds] } },
      _count: { _all: true },
    }),
  ]);
  for (const row of counts) result.set(row.threadId, { count: row.count, mentions: 0 });
  for (const row of mentions) {
    if (!row.threadId) continue;
    const entry = result.get(row.threadId) ?? { count: 0, mentions: 0 };
    result.set(row.threadId, { ...entry, mentions: row._count._all });
  }
  return result;
}

/** The two numbers a roster row carries; unread conversations only, so a read one carries none. */
export async function unreadCountFields(
  prisma: Pick<PrismaClient, "$queryRaw" | "notification">,
  userId: string,
  unreadByThread: ReadonlyMap<string, boolean>,
): Promise<(threadId: string) => { unreadCount: number; mentionCount: number }> {
  const unreadIds = [...unreadByThread].filter(([, unread]) => unread).map(([id]) => id);
  const counts = await memberUnreadCounts(prisma, userId, unreadIds);
  return (threadId) => {
    const entry = unreadByThread.get(threadId) ? counts.get(threadId) : undefined;
    return { unreadCount: entry?.count ?? 0, mentionCount: entry?.mentions ?? 0 };
  };
}
