import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentChildEnv, BLOCKED_AGENT_ENV, findAgentBinary } from "./agent-process.js";

describe("agentChildEnv", () => {
  it("copies only the allow-list and what the caller adds", () => {
    const source: NodeJS.ProcessEnv = {
      PATH: "/bin",
      HOME: "/h",
      DATABASE_URL: "x",
      ENCRYPTION_KEY: "x",
      BETTER_AUTH_SECRET: "x",
      SANDBOX_SUPERVISOR_TOKEN: "x",
      COMPOSIO_API_KEY: "x",
      ...Object.fromEntries(BLOCKED_AGENT_ENV.map((name) => [name, "x"])),
    };
    expect(Object.keys(agentChildEnv({ X: "1" }, source)).sort()).toEqual(["HOME", "PATH", "X"]);
  });

  it("refuses to add a billing route", () => {
    expect(() => agentChildEnv({ ANTHROPIC_API_KEY: "k" })).toThrow();
  });
});

describe("findAgentBinary", () => {
  it("finds an executable in the extra folders, skipping a file that is not one", async () => {
    const first = await mkdtemp(path.join(os.tmpdir(), "agent-bin-"));
    const second = await mkdtemp(path.join(os.tmpdir(), "agent-bin-"));
    await writeFile(path.join(first, "tool"), "x");
    await chmod(path.join(first, "tool"), 0o644);
    await writeFile(path.join(second, "tool"), "x");
    await chmod(path.join(second, "tool"), 0o755);
    expect(await findAgentBinary("tool", [second], { PATH: first })).toBe(
      path.join(second, "tool"),
    );
    expect(await findAgentBinary("tool", [], { PATH: first })).toBeUndefined();
  });
});
