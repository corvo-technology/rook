import type {
  CliEngineEvent,
  CliStreamExpectations,
  CliStreamParser,
} from "./cli-engine-parser.js";

/** The name Claude Code gives the tool gateway; its tools appear as `mcp__corvo__<name>`. */
export const CLAUDE_GATEWAY_NAME = "corvo";

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function parseLine(line: string): Json | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    return asObject(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Why the start event is not what a turn with no built-in tools reports, if it is not. */
function startViolation(event: Json, expect: CliStreamExpectations): string | undefined {
  if (event.type !== "system" || event.subtype !== "init") {
    return "The first event was not the start event.";
  }
  const prefix = `mcp__${expect.gatewayName}__`;
  const tools = Array.isArray(event.tools) ? event.tools : undefined;
  if (!tools) return "The start event did not list its tools.";
  for (const tool of tools) {
    if (
      typeof tool !== "string" ||
      !tool.startsWith(prefix) ||
      !expect.toolNames.has(tool.slice(prefix.length))
    ) {
      return "The start event listed a tool this turn was not given.";
    }
  }
  const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : undefined;
  const only = servers?.length === 1 ? asObject(servers[0]) : undefined;
  if (!only || only.name !== expect.gatewayName || only.status !== "connected") {
    return "The start event did not report only the connected tool gateway.";
  }
  if (event.apiKeySource !== "none") return "The CLI started with an API key, not a plan sign-in.";
  return undefined;
}

export function claudeStreamParser(expect: CliStreamExpectations, model: string): CliStreamParser {
  const prefix = `mcp__${expect.gatewayName}__`;
  let started = false;
  let stopped = false;
  let hadText = false;
  let finished = false;

  const violation = (reason: string): CliEngineEvent[] => {
    stopped = true;
    return [{ type: "violation", reason }];
  };

  return {
    line(line) {
      if (stopped || finished) return [];
      const event = parseLine(line);
      if (!event) return [];
      if (!started) {
        const reason = startViolation(event, expect);
        if (reason) return violation(reason);
        started = true;
        return [];
      }
      switch (event.type) {
        case "stream_event": {
          const inner = asObject(event.event);
          if (inner?.type === "message_start") return hadText ? [{ type: "turn" }] : [];
          const delta = asObject(inner?.delta);
          if (
            inner?.type === "content_block_delta" &&
            delta?.type === "text_delta" &&
            typeof delta.text === "string" &&
            delta.text
          ) {
            hadText = true;
            return [{ type: "text", text: delta.text }];
          }
          return [];
        }
        case "assistant": {
          const content = asObject(event.message)?.content;
          if (!Array.isArray(content)) return [];
          for (const block of content) {
            const item = asObject(block);
            if (item?.type === "tool_use" && !String(item.name).startsWith(prefix)) {
              return violation("The CLI used a tool of its own.");
            }
          }
          return [];
        }
        case "result": {
          finished = true;
          if (event.subtype === "success" && event.is_error !== true) {
            const usage = asObject(event.usage) ?? {};
            return [
              {
                type: "usage",
                provider: "cli-engine",
                model,
                inputTokens: count(usage.input_tokens),
                cacheReadTokens: count(usage.cache_read_input_tokens),
                cacheWriteTokens: count(usage.cache_creation_input_tokens),
                outputTokens: count(usage.output_tokens),
                // A plan has no per-token bill, and the CLI's own cost figure is an estimate.
                costUsd: null,
                usageSource: "cli-engine",
              },
              { type: "done" },
            ];
          }
          const text = typeof event.result === "string" ? event.result.trim() : "";
          return [
            {
              type: "failed",
              message: text || `Claude Code ended with an error (${String(event.subtype)}).`,
            },
          ];
        }
        default:
          return [];
      }
    },
    end(exitCode, stderrTail) {
      if (finished) return [];
      const tail = stderrTail
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-3);
      const head = `Claude Code exited without a reply (code ${exitCode}).`;
      return [{ type: "failed", message: tail.length ? `${head}\n${tail.join("\n")}` : head }];
    },
  };
}
