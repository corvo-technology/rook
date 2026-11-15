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
