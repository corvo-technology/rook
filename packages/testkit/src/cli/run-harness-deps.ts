import type { AgentRuntime } from "@corvo/adapter-kit";
import { approvalPausedToolResult } from "../../../adapters/src/approval-effect.ts";
import { partitionTools } from "../../../adapters/src/builtin-tool-bridge.ts";
import { estimateTextTokens } from "../../../adapters/src/context-selection.ts";
import { PiAgentRuntime } from "../../../adapters/src/pi-runtime.ts";
import { selectBuiltinToolsForRun } from "../../../adapters/src/run-tool-selection.ts";
import type { HarnessDeps } from "../evals/run-harness.js";

/** The real product pieces a harness run drives, imported from source to skip the adapters barrel. */
export function harnessDeps(
  createRuntime: () => AgentRuntime = () => new PiAgentRuntime(),
): HarnessDeps {
  return {
    createRuntime,
    selectBuiltinTools: (options) =>
      selectBuiltinToolsForRun(options as Parameters<typeof selectBuiltinToolsForRun>[0]),
    listedTools: (tools) => partitionTools(tools).listed,
    approvalPausedToolResult,
    estimateTokens: estimateTextTokens,
  };
}
