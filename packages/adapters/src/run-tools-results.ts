import { readRunToolResult } from "@corvo/db";
import { redactConnectorPayload } from "./connector-safety.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/**
 * Pages and searches a tool result this run kept whole. The lookup is bound to this run and
 * its space, so a handle from anywhere else answers like an unknown one.
 */
export const resultTools: ToolHandlers = {
  async read_result(ctx, call) {
    const { args } = call;
    const handle = typeof args.handle === "string" ? args.handle.trim() : "";
    const number = (value: unknown) => (typeof value === "number" ? value : undefined);
    const read = handle
      ? await readRunToolResult(
          ctx.deps.prisma,
          { runId: ctx.run.id, spaceId: ctx.run.spaceId },
          {
            handle,
            offset: number(args.offset),
            length: number(args.length),
            grep: typeof args.grep === "string" ? args.grep : undefined,
            context: number(args.context),
          },
        )
      : undefined;
    if (!read) {
      return call.finish({
        error:
          "No kept result has this handle in this run. Use the handle from the truncation note.",
      });
    }
    return call.finish(redactConnectorPayload({ untrusted: true, ...read }, ctx.secrets));
  },
};
