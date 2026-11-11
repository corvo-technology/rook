import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent, ConnectorTool } from "@corvo/adapter-kit";
import type { CliEngineId, CliEngineState } from "@corvo/contracts";
import type { CliEngineLocator } from "./cli-engine-runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "test-support", "fake-claude-cli.mjs");

export interface FakeClaude {
  dir: string;
  binary: string;
  log: string;
}

/** A script that runs the fake CLI with extra environment baked in, since turns get a small one. */
export async function makeFakeClaude(extraEnv: Record<string, string> = {}): Promise<FakeClaude> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "fake-claude-"));
  const log = path.join(dir, "log.jsonl");
  await writeFile(log, "");
  const assignments = Object.entries({ FAKE_CLAUDE_LOG: log, ...extraEnv })
    .map(([key, value]) => `${key}='${value}'`)
    .join(" ");
  const binary = path.join(dir, "claude");
  await writeFile(
    binary,
    `#!/bin/sh\nexec env ${assignments} "${process.execPath}" "${FAKE}" "$@"\n`,
  );
  await chmod(binary, 0o755);
  return { dir, binary, log };
}

export async function readFakeLog(fake: FakeClaude) {
  const text = await readFile(fake.log, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map(
      (line) =>
        JSON.parse(line) as { argv: string[]; env: string[]; stdin: string; tools: string[] },
    );
}

export function fakeLocator(
  fake: FakeClaude,
  overrides: Partial<CliEngineLocator> & { state?: CliEngineState } = {},
): CliEngineLocator {
  const { state, ...rest } = overrides;
  return {
    binary: async () => fake.binary,
    redetect: async () => fake.binary,
    configDir: () => path.join(fake.dir, "config"),
    turnsDir: () => path.join(fake.dir, "turns"),
    ready: async (_id: CliEngineId) => state ?? "ready",
    ...rest,
  };
}

export const tool = (name: string, extra: Partial<ConnectorTool> = {}): ConnectorTool => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
  ...extra,
});

export function cliRequest(
  prompt: string,
  overrides: Partial<AgentRunRequest> = {},
): AgentRunRequest {
  return {
    botId: "bot-1",
    threadId: "thread-1",
    runId: `run-${Math.random().toString(36).slice(2)}`,
    prompt,
    instructions: "SECRET-INSTRUCTIONS be kind",
    history: [],
    tools: [tool("echo_text")],
    model: { provider: "cli-engine", id: "claude/sonnet" },
    ...overrides,
  };
}

export async function collect(events: AsyncIterable<AgentRuntimeEvent>) {
  const out: AgentRuntimeEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}
