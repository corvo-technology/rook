import type { ThreadMessage } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { appendEventInTransaction, IsolationError } from "@corvo/db";
import { withRoutineNames } from "./thread-message-pages.js";
import type { ThreadTarget } from "./thread-target.js";

/** How many pinned messages the header lists. */
const PINNED_LIMIT = 50;

/**
 * Pins a message to its thread, or takes it off. Whoever can post in the thread can do it, and
 * asking for the state the message already has changes nothing and sends no event.
 */
export async function pinThreadMessage(
  prisma: PrismaClient,
  actor: { spaceId: string; userId: string },
  target: ThreadTarget,
  input: { messageId: string; pinned: boolean },
): Promise<{ pinnedAt: Date | null; eventSeq: number | null }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const message = await tx.message.findFirst({
      where: { id: input.messageId, threadId: target.threadId },
      select: { id: true, pinnedAt: true },
    });
    if (!message) throw new IsolationError();
    if (Boolean(message.pinnedAt) === input.pinned) {
      return { pinnedAt: message.pinnedAt, eventSeq: null };
    }
    const pinnedAt = input.pinned ? new Date() : null;
    await tx.message.update({
      where: { id: message.id },
      data: { pinnedAt, pinnedBy: input.pinned ? actor.userId : null },
    });
    const botId = target.kind === "bot" ? target.botId : target.memberBotIds[0];
    if (!botId) throw new IsolationError();
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId: target.threadId,
      botId,
      type: "thread.message.pinned",
      payload: { messageId: message.id, pinnedAt: pinnedAt?.toISOString() ?? null },
    });
    return { pinnedAt, eventSeq: event.seq };
  });
}

/** The pinned messages of a thread, the most recently pinned first. */
export async function listPinnedMessages(
  prisma: PrismaClient,
  target: ThreadTarget,
): Promise<ThreadMessage[]> {
  const rows = await prisma.message.findMany({
    where: { threadId: target.threadId, pinnedAt: { not: null } },
    orderBy: [{ pinnedAt: "desc" }, { id: "desc" }],
    take: PINNED_LIMIT,
  });
  return withRoutineNames(prisma, rows);
}
