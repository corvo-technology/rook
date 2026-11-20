import { historyCompactJob } from "@corvo/adapter-kit";
import { botContextUsage, COMPRESS_KEEP_RECENT, modelContextWindow } from "@corvo/adapters";
import { contextNeedsCompression } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import type { RouterDeps } from "./router.js";

/** Asks for the older part of a chat to be summarized now; the summary replaces it in later turns. */
export async function compressThread(deps: Pick<RouterDeps, "jobs">, threadId: string) {
  await deps.jobs.enqueue(historyCompactJob(threadId, COMPRESS_KEEP_RECENT));
}

/**
 * A message sent on another model reads the chat through that model's window. When the chat no
 * longer fits it comfortably, the older part is summarized first, as it is when a turn ends past
 * the same point. Queued before the run, so the summary is the first thing the turn can use.
 */
export async function compressForChosenModel(
  deps: Pick<RouterDeps, "jobs"> & { prisma: PrismaClient },
  scope: { spaceId: string; userId: string },
  chat: { botId: string; threadId: string },
  model: { provider: string; modelId: string },
) {
  const { usedTokens } = await botContextUsage(deps.prisma, scope, chat.botId);
  const windowTokens = modelContextWindow(model.provider, model.modelId);
  if (contextNeedsCompression({ usedTokens, windowTokens })) {
    await compressThread(deps, chat.threadId);
  }
}
