import { getLogger } from "@corvo/logging";
import type { StorageLow } from "./computer-storage.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { publishMessage } from "./run-messages.js";
import { notifyRun } from "./run-notifications.js";

export const STORAGE_FULL_NOTICE = "This agent's computer is full.";
export const STORAGE_LOW_NOTICE = "This agent's computer is almost full.";

type AlertRun = {
  id: string;
  spaceId: string;
  userId: string;
  threadId: string;
  botId: string;
  trigger: string;
  routineId?: string | null;
};

const megabytes = (bytes: number) => String(Math.round(bytes / 1024 / 1024));

/** What the web words in the person's language: the largest directories and the disk in use. */
function noticeParams(input: { usage?: string; usedBytes?: number; totalBytes?: number }) {
  return {
    ...(input.usage ? { top: input.usage } : {}),
    ...(input.usedBytes !== undefined && input.totalBytes !== undefined
      ? { usedMb: megabytes(input.usedBytes), totalMb: megabytes(input.totalBytes) }
      : {}),
  };
}

/**
 * Tells the space's owner that an agent's computer ran out of room: one chat line where it
 * happened and one push. The caller says it once per run. It never throws.
 */
export async function alertStorageFull(
  deps: ExecutorDeps,
  run: AlertRun,
  bot: { id: string; name: string },
  usage?: string,
  disk?: { usedBytes: number; totalBytes: number },
): Promise<void> {
  const text = usage ? `${STORAGE_FULL_NOTICE} Using the space: ${usage}.` : STORAGE_FULL_NOTICE;
  try {
    await publishMessage(deps, run, "system", [
      {
        kind: "meta",
        text,
        code: "sandbox_storage_full",
        params: noticeParams({ usage, ...disk }),
      },
    ]);
    await notifyRun(deps, run, {
      kind: "help",
      title: `${bot.name}'s computer is full`,
      body: text,
      botId: bot.id,
      threadId: run.threadId,
      storage: "full",
    });
  } catch (error) {
    getLogger().error("storage full alert", error);
  }
}

/**
 * Tells the space's owner, before it is full, that an agent's computer is running low: one chat
 * line with the largest directories and one inbox alert with a push. The caller has claimed the
 * day's warning. It never throws.
 */
export async function alertStorageLow(
  deps: ExecutorDeps,
  run: AlertRun,
  bot: { id: string; name: string },
  low: StorageLow,
): Promise<void> {
  const text = low.usage
    ? `${STORAGE_LOW_NOTICE} Using the space: ${low.usage}.`
    : STORAGE_LOW_NOTICE;
  try {
    await publishMessage(deps, run, "system", [
      {
        kind: "meta",
        text,
        code: "sandbox_storage_low",
        params: noticeParams({
          usage: low.usage,
          usedBytes: low.usedBytes,
          totalBytes: low.totalBytes,
        }),
      },
    ]);
    await notifyRun(
      deps,
      run,
      {
        kind: "help",
        title: `${bot.name}'s computer is almost full`,
        body: text,
        botId: bot.id,
        threadId: run.threadId,
        storage: "low",
      },
      { inbox: "alert" },
    );
  } catch (error) {
    getLogger().error("storage low alert", error);
  }
}
