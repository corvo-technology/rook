import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_ENGINE } from "./cli-engine-claude.js";
import type { CliEngineDefinition, CliEngineLocator } from "./cli-engine-runtime.js";
import { CliEngineRuntime } from "./cli-engine-runtime.js";
import {
  cliRequest,
  collect,
  type FakeClaude,
  fakeLocator,
  makeFakeClaude,
} from "./cli-engine-test-support.js";
import { CliToolGateway } from "./cli-tool-gateway.js";

/** The contract every CLI engine must meet, run offline against that engine's fake CLI. */
describe.each([
  [
    "claude",
    CLAUDE_ENGINE,
    async (): Promise<{ fake: FakeClaude; locator: CliEngineLocator }> => {
      const fake = await makeFakeClaude();
      return { fake, locator: fakeLocator(fake) };
    },
  ],
])("%s engine conformance", (_name, engine: CliEngineDefinition, setup) => {
  const gateways: CliToolGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
  });

  async function run(prompt: string) {
    const { locator } = await setup();
    const gateway = new CliToolGateway();
    gateways.push(gateway);
    const runtime = new CliEngineRuntime({ engines: [engine], locator, gateway });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const events = await collect(runtime.run(cliRequest(prompt, { executeTool })));
    return { events, executeTool };
  }

  it.each([
    ["a plain reply", "hello", 0],
    ["an allowed tool", 'CALL echo_text {"text":"hi"}', 1],
    ["a refused tool", "CALL shell {}", 0],
  ])("meets the contract for %s", async (_label, prompt, calls) => {
    const { events, executeTool } = await run(prompt);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("done");
    const usage = events.filter((event) => event.type === "usage");
    expect(usage.length).toBeLessThanOrEqual(1);
    for (const event of usage) expect(event).toMatchObject({ provider: "cli-engine" });
    expect(events.filter((event) => event.type === "tool")).toHaveLength(calls);
    expect(executeTool).toHaveBeenCalledTimes(calls);
  });
});
