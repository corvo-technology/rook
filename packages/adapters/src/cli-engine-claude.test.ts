import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_GATEWAY_NAME, claudeStreamParser } from "./cli-engine-claude.js";
import type { CliEngineEvent } from "./cli-engine-parser.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  readFileSync(path.join(here, "test-support", name), "utf8").split("\n");

function parse(lines: string[], tools: string[] = ["echo_text"]): CliEngineEvent[] {
  const parser = claudeStreamParser(
    { gatewayName: CLAUDE_GATEWAY_NAME, toolNames: new Set(tools) },
    "claude/sonnet",
  );
  return lines.flatMap((line) => parser.line(line));
}

const init = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    tools: ["mcp__corvo__echo_text"],
    mcp_servers: [{ name: "corvo", status: "connected" }],
    apiKeySource: "none",
    ...patch,
  });

describe("Claude Code stream parser", () => {
  it("maps a tool round to text, a turn and one usage, then done", () => {
    const events = parse(fixture("claude-stream-tool.jsonl"));
    expect(events.some((event) => event.type === "violation")).toBe(false);
    expect(events.some((event) => event.type === "text")).toBe(true);
    expect(events.filter((event) => event.type === "turn")).toHaveLength(1);
    const usage = events.filter((event) => event.type === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: "cli-engine",
      costUsd: null,
      usageSource: "cli-engine",
      inputTokens: 120,
      cacheReadTokens: 400,
      cacheWriteTokens: 30,
      outputTokens: 45,
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("reports a violation first when the start lists tools of this turn that do not exist", () => {
    const events = parse(fixture("claude-stream-tool.jsonl"), []);
    expect(events[0]?.type).toBe("violation");
    expect(events).toHaveLength(1);
  });

  it("reports a violation when a built-in tool is listed", () => {
    expect(parse(fixture("claude-stream-builtin.jsonl"))[0]?.type).toBe("violation");
  });

  it.each([
    ["an API key source", init({ apiKeySource: "ANTHROPIC_API_KEY" })],
    [
      "two MCP servers",
      init({
        mcp_servers: [
          { name: "corvo", status: "connected" },
          { name: "other", status: "connected" },
        ],
      }),
    ],
    ["a failed gateway", init({ mcp_servers: [{ name: "corvo", status: "failed" }] })],
    ["a stream event before the start", JSON.stringify({ type: "stream_event", event: {} })],
  ])("reports a violation for %s", (_name, line) => {
    expect(parse([line])[0]?.type).toBe("violation");
  });

  it("reports a violation when the CLI uses a tool of its own after a clean start", () => {
    const events = parse([
      init(),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "t", name: "Read", input: {} }] },
      }),
    ]);
    expect(events.map((event) => event.type)).toEqual(["violation"]);
  });

  it("fails with the CLI's message and no done", () => {
    const events = parse(fixture("claude-stream-error.jsonl"));
    expect(events.map((event) => event.type)).toEqual(["failed"]);
    expect(events[0]).toMatchObject({
      message: "Claude Code ended with an error (error_during_execution).",
    });
  });

  it("explains an exit without a reply, with the end of stderr", () => {
    const parser = claudeStreamParser({ gatewayName: "corvo", toolNames: new Set() }, "m");
    expect(parser.end(1, "a\n\nb\nc\nd\n")).toEqual([
      { type: "failed", message: "Claude Code exited without a reply (code 1).\nb\nc\nd" },
    ]);
  });

  it("has nothing to add when the process ends after a result", () => {
    const parser = claudeStreamParser(
      { gatewayName: "corvo", toolNames: new Set(["echo_text"]) },
      "m",
    );
    for (const line of fixture("claude-stream-tool.jsonl")) parser.line(line);
    expect(parser.end(0, "")).toEqual([]);
  });

  it("ignores lines that are not JSON objects", () => {
    const events = parse(["not json", init(), "also not json", "[1]"]);
    expect(events).toEqual([]);
  });
});
