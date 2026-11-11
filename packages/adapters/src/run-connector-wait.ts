import { getLogger } from "@corvo/logging";
import type { ConnectorStatusId } from "./connector-status.js";
import { findStatusTool, readConnectorStatus } from "./connector-status.js";
import {
  abortableSleep,
  awaitConnectorResult,
  CONNECTOR_WAIT_LIMITS,
  connectorWaitNote,
} from "./connector-wait.js";
import { CATALOG_EXECUTE } from "./lazy-tool-catalog.js";
import { waitingActivityText } from "./pi-runtime-tools.js";
import type { RunContext } from "./run-context.js";
import { withGuardNote } from "./run-guards.js";
import { publishActivityLine } from "./run-progress.js";
import type { ToolCall } from "./run-tool-gate.js";
import { statusCallAllowed } from "./run-tool-gate.js";

/**
 * A connector tool that answered "still being made" gets its own status tool asked, with
 * backoff, until the work is done. Returns what the agent should see: the finished result,
 * or the first result unchanged when nothing can be waited on.
 */
export async function waitForConnectorResult(
  ctx: RunContext,
  call: ToolCall,
  first: unknown,
): Promise<unknown> {
  const { deps } = ctx;
  if (!deps.connector) return first;
  const called = ctx.tools.connector.get(call.name);
  if (called?.readOnly !== true) return first;
  if (!called.route?.resourceId || called.route.toolName === CATALOG_EXECUTE) return first;
  const status = readConnectorStatus(first);
  if (!status?.pending) return first;
  const found = findStatusTool({
    called,
    calledArgs: call.args,
    tools: ctx.tools.connector.values(),
    status,
    disabled: ctx.tools.disabled,
  });
  if (!found || !(await statusCallAllowed(ctx, found.tool))) return first;
  const { tool: statusTool, args } = found;
  const connector = deps.connector;
  let polls = 0;
  const outcome = await awaitConnectorResult(
    first,
    status,
    args,
    async () => {
      let answer: { result: unknown } | { error: string } = { error: "no result" };
      for await (const event of connector.execute(
        {
          tool: statusTool.name,
          args,
          executionId: `${call.effectKey}:wait:${++polls}`,
          connectionId: call.connectorCall.connectionId,
          route: statusTool.route,
        },
        ctx.context,
      )) {
        if (event.type === "result") answer = { result: event.data };
        if (event.type === "error") answer = { error: event.message };
      }
      return answer;
    },
    {
      limits: { ...CONNECTOR_WAIT_LIMITS, ...deps.connectorWait?.limits },
      sleep: deps.connectorWait?.sleep ?? abortableSleep,
      now: deps.connectorWait?.now ?? Date.now,
      signal: ctx.context.signal,
      active: () => ctx.state.lease.valid,
      onFirstPause: () => publishActivityLine(ctx, waitingActivityText(call.name)),
    },
  );
  getLogger().info("connector.wait_finished", {
    "tool.name": call.name,
    "status_tool.name": statusTool.name,
    "wait.polls": outcome.polls,
    "wait.ms": outcome.ms,
    "wait.outcome": outcome.kind,
  });
  if (outcome.kind === "time" || outcome.kind === "status_error") {
    return withGuardNote(
      outcome.result,
      connectorWaitNote(outcome, statusTool.name, args as Record<string, ConnectorStatusId>),
    );
  }
  return outcome.kind === "not_status" ? first : outcome.result;
}
