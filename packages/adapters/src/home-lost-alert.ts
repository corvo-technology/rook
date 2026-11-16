import { getLogger } from "@corvo/logging";
import type { ExecutorDeps } from "./executor-deps.js";
import { publishMessage } from "./run-messages.js";

export const HOME_LOST_NOTICE = "This computer's saved files couldn't be found; it started fresh.";

/**
 * Tells the space's owner, with one chat line where it happened, that an agent's computer
 * started without its saved files because they were missing from storage. The caller says it
 * once per run. It never throws.
 */
export async function alertHomeLost(
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
): Promise<void> {
  try {
    await publishMessage(deps, run, "system", [
      { kind: "meta", text: HOME_LOST_NOTICE, code: "computer_home_lost" },
    ]);
  } catch (error) {
    getLogger().error("computer home lost alert", error);
  }
}
