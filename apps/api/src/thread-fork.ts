import type { JobPublisher } from "@corvo/adapter-kit";
import { historyCompactJob } from "@corvo/adapter-kit";
import { COMPRESS_KEEP_RECENT } from "@corvo/adapters";
import type { Actor, MessageBlock } from "@corvo/contracts";
import type { createRepos, PrismaClient } from "@corvo/db";
import { createThreadMessageInTransaction, IsolationError, visibleMessagesWhere } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { duplicateBot } from "./bot-duplicate.js";

/** Most messages one copy carries; older ones stay in the chat it came from. */
export const FORK_MAX_MESSAGES = 500;
/** Past this many messages the copy gets the same summary of its older part a long chat does. */
export const FORK_SUMMARY_AFTER = 30;

/** The text of a message, which is all a copy carries; cards and attachments belong to the first chat. */
function textBlocks(blocks: unknown): MessageBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (block): block is MessageBlock =>
      (block as { kind?: unknown } | null)?.kind === "text" &&
      typeof (block as { text?: unknown }).text === "string",
  );
}

/**
 * Carries a chat on in a new one: a copy of the agent, and a copy of the conversation up to the
 * given message on the version on screen. A long copy is summarized by the usual history
 * compaction, so the agent starts from a short hand-off of what came before, not the full text.
 */
export async function forkConversation(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  repos: ReturnType<typeof createRepos>,
  actor: Actor,
  source: { threadId: string; botId: string },
  messageId: string,
): Promise<{ botId: string; name: string }> {
  const visible = await visibleMessagesWhere(deps.prisma, source.threadId);
  const upTo = await deps.prisma.message.findFirst({
    where: { id: messageId, threadId: source.threadId, AND: [visible] },
    select: { seq: true },
  });
  if (!upTo) throw new IsolationError();
  const newest = await deps.prisma.message.findMany({
    where: {
      threadId: source.threadId,
      AND: [visible],
      seq: { lte: upTo.seq },
      role: { in: ["user", "bot"] },
    },
    orderBy: { seq: "desc" },
    take: FORK_MAX_MESSAGES,
    select: { role: true, blocks: true, authorUserId: true },
  });
  const copied = newest
    .reverse()
    .map((message) => ({ ...message, blocks: textBlocks(message.blocks) }))
    .filter((message) => message.blocks.length > 0);
  const duplicate = await duplicateBot(deps, repos, actor, source.botId);
  const thread = await deps.prisma.thread.findUnique({
    where: { botId: duplicate.id },
    select: { id: true },
  });
  if (!thread) throw new IsolationError();
  await deps.prisma.$transaction(async (tx) => {
    for (const message of copied) {
      await createThreadMessageInTransaction(tx, {
        threadId: thread.id,
        role: message.role as "user" | "bot",
        blocks: message.blocks,
        botId: message.role === "bot" ? duplicate.id : undefined,
        authorUserId: message.authorUserId ?? undefined,
        markUnread: false,
      });
    }
  });
  if (copied.length > FORK_SUMMARY_AFTER) {
    // Best effort: without the summary the copy still reads in full on screen.
    await deps.jobs.enqueue(historyCompactJob(thread.id, COMPRESS_KEEP_RECENT)).catch((error) => {
      getLogger().error("thread fork history summary enqueue", error);
    });
  }
  return { botId: duplicate.id, name: duplicate.name };
}
