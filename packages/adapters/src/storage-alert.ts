import { getLogger } from "@corvo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { publishMessage } from "./run-messages.js";
import { notifyRun } from "./run-notifications.js";

export const STORAGE_FULL_NOTICE = "This agent's computer is full.";

/**
 * Tells the space's owner that an agent's computer ran out of room: one chat line where it
 * happened and one push. The caller says it once per run. It never throws.
 */
export async function alertStorageFull(
  deps: ExecutorDeps,
  run: {
    id: string;
    spaceId: string;
    userId: string;
    threadId: string;
    botId: string;
    trigger: string;
    routineId?: string | null;
  },
  bot: { id: string; name: string },
  usage?: string,
): Promise<void> {
  const text = usage ? `${STORAGE_FULL_NOTICE} Using the space: ${usage}.` : STORAGE_FULL_NOTICE;
  try {
    await publishMessage(deps, run, "system", [
      { kind: "meta", text, code: "sandbox_storage_full" },
    ]);
    await notifyRun(deps, run, {
      kind: "help",
      title: `${bot.name}'s computer is full`,
      body: text,
      botId: bot.id,
      threadId: run.threadId,
    });
  } catch (error) {
    getLogger().error("storage full alert", error);
  }
}
