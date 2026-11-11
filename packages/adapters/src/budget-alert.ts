import { crossedMonthAlert, utcMonthKey } from "@corvo/core";
import { claimBudgetAlert } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { publishMessage } from "./run-messages.js";
import { notifyRun } from "./run-notifications.js";

const numbers = new Intl.NumberFormat("en");

/**
 * Once per bot per month, when this attempt's spend carries the month across 80% of the limit:
 * one chat line where it happened and one push. It never throws.
 */
export async function alertIfMonthCrossed(
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
  input: { usedBefore: number; spentThisAttempt: number; limit: number | null },
  now = new Date(),
): Promise<void> {
  try {
    const usedAfter = input.usedBefore + input.spentThisAttempt;
    if (!crossedMonthAlert(input.usedBefore, usedAfter, input.limit)) return;
    if (!(await claimBudgetAlert(deps.prisma, bot.id, utcMonthKey(now)))) return;
    const text = `${numbers.format(usedAfter)} of ${numbers.format(input.limit ?? 0)} tokens`;
    await publishMessage(deps, run, "system", [{ kind: "meta", text }]);
    await notifyRun(deps, run, {
      kind: "help",
      title: `${bot.name} used 80% of its monthly token limit`,
      body: text,
      botId: bot.id,
      threadId: run.threadId,
    });
  } catch (error) {
    getLogger().error("budget alert", error);
  }
}
