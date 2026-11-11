import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CLI_ENGINE_RUN_ERRORS } from "@corvo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalPausedToolResult } from "./approval-effect.js";
import { CLAUDE_ENGINE } from "./cli-engine-claude.js";
import { CliEngineRuntime } from "./cli-engine-runtime.js";
import {
  cliRequest,
  collect,
  fakeLocator,
  makeFakeClaude,
  readFakeLog,
  tool,
} from "./cli-engine-test-support.js";
import { CliToolGateway } from "./cli-tool-gateway.js";

const errors = CLI_ENGINE_RUN_ERRORS.claude;

describe("CliEngineRuntime", () => {
  let gateway: CliToolGateway;
  beforeEach(() => {
    gateway = new CliToolGateway();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await gateway.stop();
  });

  const runtimeFor = async (
    extraEnv: Record<string, string> = {},
    locator?: Parameters<typeof fakeLocator>[1],
    maxConcurrent?: number,
  ) => {
    const fake = await makeFakeClaude(extraEnv);
    const runtime = new CliEngineRuntime({
      engines: [CLAUDE_ENGINE],
      locator: fakeLocator(fake, locator),
      gateway,
      maxConcurrent,
    });
    return { fake, runtime };
  };

  it("streams text, accounts usage once and ends with done", async () => {
    const { runtime } = await runtimeFor();
    const onUsage = vi.fn().mockResolvedValue(undefined);
    const events = await collect(runtime.run(cliRequest("hello", { onUsage })));
    expect(events.some((event) => event.type === "text")).toBe(true);
    const usage = events.filter((event) => event.type === "usage");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ accounted: true, provider: "cli-engine", costUsd: null });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("runs an allowed tool through executeTool after a tool event", async () => {
    const { runtime } = await runtimeFor();
    const executeTool = vi.fn().mockResolvedValue({ echoed: "hi" });
    const events = await collect(
      runtime.run(cliRequest('CALL echo_text {"text":"hi"}', { executeTool })),
    );
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(executeTool).toHaveBeenCalledWith(
      "echo_text",
      { text: "hi" },
      expect.stringContaining("cli-tool"),
      undefined,
    );
    const toolEvent = events.findIndex((event) => event.type === "tool");
    expect(toolEvent).toBeGreaterThanOrEqual(0);
    const text = events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");
    expect(text).toContain("echoed");
  });

  it("never reaches executeTool for a tool the turn does not have", async () => {
    const { runtime } = await runtimeFor();
    const executeTool = vi.fn();
    const events = await collect(runtime.run(cliRequest("CALL shell {}", { executeTool })));
    expect(executeTool).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("unwraps use_tool to the inner tool", async () => {
    const { runtime } = await runtimeFor();
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const events = await collect(
      runtime.run(
        cliRequest('CALL use_tool {"name":"schedule_update","arguments":{"id":"1"}}', {
          executeTool,
          tools: [tool("schedule_list"), tool("schedule_update")],
        }),
      ),
    );
    expect(executeTool).toHaveBeenCalledWith(
      "schedule_update",
      { id: "1" },
      expect.any(String),
      undefined,
    );
    expect(events.find((event) => event.type === "tool")).toMatchObject({
      name: "schedule_update",
      viaUseTool: true,
    });
  });

  it("stops the reply when the CLI started with a tool it was not given", async () => {
    const { runtime } = await runtimeFor({ FAKE_CLAUDE_EXTRA_TOOL: "Bash" });
    const executeTool = vi.fn();
    await expect(
      collect(runtime.run(cliRequest('CALL echo_text {"text":"x"}', { executeTool }))),
    ).rejects.toThrow(errors.unsafe);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("ends the turn and the process when a tool pauses for approval", async () => {
    const { runtime, fake } = await runtimeFor();
    const executeTool = vi.fn().mockResolvedValue(approvalPausedToolResult());
    const events = await collect(
      runtime.run(cliRequest('CALL echo_text {"text":"x"}', { executeTool })),
    );
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((event) => event.type === "usage")).toBe(false);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect((await readFakeLog(fake)).length).toBe(1);
  });

  it("ends without done when aborted, and the session is gone", async () => {
    const { runtime, fake } = await runtimeFor();
    const controller = new AbortController();
    const request = cliRequest("HANG");
    const seen: string[] = [];
    const started = Date.now();
    for await (const event of runtime.run(request, { signal: controller.signal })) {
      seen.push(event.type);
      if (seen.length === 1) controller.abort();
    }
    expect(seen).not.toContain("done");
    expect(Date.now() - started).toBeLessThan(6_000);
    expect((await readFakeLog(fake))[0]?.argv).toContain("-p");
  });

  it("answers 404 on the session URL once the run has ended", async () => {
    const { runtime } = await runtimeFor();
    let url = "";
    const original = gateway.open.bind(gateway);
    vi.spyOn(gateway, "open").mockImplementation(async (session) => {
      const opened = await original(session);
      url = opened.url;
      return opened;
    });
    await collect(runtime.run(cliRequest("hi")));
    expect(url).not.toBe("");
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("keeps secrets and the instructions out of the arguments and the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-leak");
    vi.stubEnv("DATABASE_URL", "postgres://leak");
    vi.stubEnv("ENCRYPTION_KEY", "leak");
    const { runtime, fake } = await runtimeFor();
    await collect(runtime.run(cliRequest("hello")));
    const [entry] = await readFakeLog(fake);
    const joined = entry?.argv.join(" ") ?? "";
    expect(joined).not.toMatch(/[0-9a-f]{48}/);
    expect(joined).not.toContain("SECRET-INSTRUCTIONS");
    expect(entry?.stdin).not.toContain("SECRET-INSTRUCTIONS");
    for (const name of ["ANTHROPIC_API_KEY", "DATABASE_URL", "ENCRYPTION_KEY"]) {
      expect(entry?.env).not.toContain(name);
    }
    expect(entry?.env).toContain("CORVO_MCP_URL");
    expect(entry?.env).toContain("CLAUDE_CONFIG_DIR");
  });

  it("detects again once when the binary moved", async () => {
    const fake = await makeFakeClaude();
    const redetect = vi.fn().mockResolvedValue(fake.binary);
    const runtime = new CliEngineRuntime({
      engines: [CLAUDE_ENGINE],
      locator: fakeLocator(fake, {
        binary: async () => path.join(fake.dir, "gone", "claude"),
        redetect,
      }),
      gateway,
    });
    const events = await collect(runtime.run(cliRequest("hi")));
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(redetect).toHaveBeenCalledTimes(1);
  });

  it("says the CLI is missing when it is still gone after detecting again", async () => {
    const fake = await makeFakeClaude();
    const runtime = new CliEngineRuntime({
      engines: [CLAUDE_ENGINE],
      locator: fakeLocator(fake, {
        binary: async () => path.join(fake.dir, "gone", "claude"),
        redetect: async () => undefined,
      }),
      gateway,
    });
    await expect(collect(runtime.run(cliRequest("hi")))).rejects.toThrow(errors.missing);
  });

  it("does not spawn when the CLI is signed in with an API key", async () => {
    const { runtime, fake } = await runtimeFor({}, { state: "api_key" });
    await expect(collect(runtime.run(cliRequest("hi")))).rejects.toThrow(errors.signedOut);
    expect(await readFakeLog(fake)).toHaveLength(0);
  });

  it("refuses a run metered as hosted credits before spawning", async () => {
    const { runtime, fake } = await runtimeFor();
    const request = cliRequest("hi");
    request.model = {
      ...request.model,
      callObserver: { beforeCall: () => "r", afterCall: () => undefined },
    };
    await expect(collect(runtime.run(request))).rejects.toThrow();
    expect(await readFakeLog(fake)).toHaveLength(0);
  });

  it("holds a fifth turn until a slot is free", async () => {
    const { runtime, fake } = await runtimeFor({}, undefined, 4);
    await mkdir(path.join(fake.dir, "turns"), { recursive: true });
    const controllers = Array.from({ length: 5 }, () => new AbortController());
    const runs = controllers.map((controller) =>
      collect(runtime.run(cliRequest("HANG"), { signal: controller.signal })),
    );
    await vi.waitFor(async () => expect((await readFakeLog(fake)).length).toBe(4), {
      timeout: 15_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await readFakeLog(fake)).length).toBe(4);
    controllers[0]?.abort();
    await vi.waitFor(async () => expect((await readFakeLog(fake)).length).toBe(5), {
      timeout: 15_000,
    });
    for (const controller of controllers) controller.abort();
    await Promise.all(runs);
  }, 30_000);
});
