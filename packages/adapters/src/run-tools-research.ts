import { executeResearchStart, executeResearchStatus } from "./research-service.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** Background research: start a job, then read how it is going or what it found. */
export const researchTools: ToolHandlers = {
  async research_start(ctx, call) {
    const { deps, run, bot, context } = ctx;
    return call.finish(
      await executeResearchStart(
        deps,
        { ...context, operationId: call.effectKey, botId: bot.id },
        { id: run.id, threadId: run.threadId, trigger: run.trigger },
        call.args,
      ),
    );
  },
  async research_status(ctx, call) {
    const { deps, run, bot, context } = ctx;
    return call.finish(
      await executeResearchStatus(
        deps,
        { ...context, operationId: call.effectKey, botId: bot.id },
        { threadId: run.threadId },
        call.args,
      ),
    );
  },
};
