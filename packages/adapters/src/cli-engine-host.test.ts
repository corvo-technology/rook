import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_ENGINE } from "./cli-engine-claude.js";
import { CliEngineHost, cliEngineConfigDir, routeAgentRuntime } from "./cli-engine-host.js";
import { CliEngineRuntime } from "./cli-engine-runtime.js";
import { cliRequest, collect, fakeLocator, makeFakeClaude } from "./cli-engine-test-support.js";
import { CliToolGateway } from "./cli-tool-gateway.js";

const readyProbe = (auth = '{"loggedIn":true,"authMethod":"claude.ai"}') =>
  vi.fn(async (_bin: string, args: string[], _env: Record<string, string>) =>
    args[0] === "--version"
      ? { code: 0, stdout: "2.5.0 (Claude Code)" }
      : { code: 0, stdout: auth },
  );

const host = (run: ReturnType<typeof readyProbe>, now = () => 0) =>
  new CliEngineHost({
    dataDir: "/data",
    engines: [CLAUDE_ENGINE],
    run,
    now,
    locate: async () => "/bin/claude",
  });

describe("CliEngineHost", () => {
  it("offers a ready engine's models and keeps no path", async () => {
    const h = host(readyProbe());
    const view = await h.view();
    expect(view.enabled).toBe(true);
    expect(view.engines).toHaveLength(1);
    expect(view.engines[0]).toMatchObject({
      id: "claude",
      state: "ready",
      models: ["claude/sonnet", "claude/opus", "claude/haiku"],
    });
    expect(JSON.stringify(view)).not.toContain("/bin/claude");
    expect(h.offers("claude/sonnet")).toBe(true);
    expect(h.catalog().map((entry) => entry.id)).toEqual([
      "claude/sonnet",
      "claude/opus",
      "claude/haiku",
    ]);
    expect(h.catalog()[0]).toMatchObject({
      provider: "cli-engine",
      providerName: "Claude Code",
      label: "Sonnet",
      billing: "Claude Code plan",
      managed: true,
    });
  });

  it("caches for a minute and refreshes on request", async () => {
    let now = 0;
    const run = readyProbe();
    const h = host(run, () => now);
    await h.view();
    const calls = run.mock.calls.length;
    now = 30_000;
    await h.view();
    expect(run.mock.calls.length).toBe(calls);
    await h.refresh();
    expect(run.mock.calls.length).toBeGreaterThan(calls);
  });

  it("offers nothing when signed out", async () => {
    const h = host(readyProbe('{"loggedIn":false}'));
    const view = await h.view();
    expect(view.engines[0]).toMatchObject({ state: "signed_out", models: [] });
    expect(h.offers("claude/sonnet")).toBe(false);
    expect(h.catalog()).toEqual([]);
  });

  it("shares one detection between turns that hit a moved binary together", async () => {
    let finish: (value: string) => void = () => undefined;
    const locate = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
    const h = new CliEngineHost({
      dataDir: "/data",
      engines: [CLAUDE_ENGINE],
      run: readyProbe(),
      locate,
    });
    const both = Promise.all([h.redetect("claude"), h.redetect("claude")]);
    finish("/bin/claude");
    expect(await both).toEqual(["/bin/claude", "/bin/claude"]);
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it("probes with the engine's own config folder under the data dir", async () => {
    const run = readyProbe();
    await host(run).view();
    const env = run.mock.calls[0]?.[2] as Record<string, string>;
    expect(env.CLAUDE_CONFIG_DIR).toBe(cliEngineConfigDir("/data", "claude"));
    expect(env.CLAUDE_CONFIG_DIR).toMatch(/^\/data\//);
  });

  it("reports a missing binary", async () => {
    const h = new CliEngineHost({
      dataDir: "/data",
      engines: [CLAUDE_ENGINE],
      run: readyProbe(),
      locate: async () => undefined,
    });
    expect((await h.view()).engines[0]?.state).toBe("missing");
  });
});

describe("routeAgentRuntime", () => {
  const gateways: CliToolGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
  });
  const base = () => ({
    describe: () => ({
      id: "base",
      contractVersion: "1",
      adapterVersion: "1",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: false },
    }),
    run: vi.fn(async function* () {
      yield { type: "text" as const, text: "from base" };
      yield { type: "done" as const };
    }),
    abort: vi.fn(async () => undefined),
  });

  it("sends cli-engine runs to the CLI runtime and the rest to the base", async () => {
    const fake = await makeFakeClaude();
    const gateway = new CliToolGateway();
    gateways.push(gateway);
    const cli = new CliEngineRuntime({
      engines: [CLAUDE_ENGINE],
      locator: fakeLocator(fake),
      gateway,
    });
    const b = base();
    const routed = routeAgentRuntime(b, cli);
    const viaCli = await collect(routed.run(cliRequest("hello")));
    expect(viaCli.some((event) => event.type === "usage")).toBe(true);
    expect(b.run).not.toHaveBeenCalled();
    const request = cliRequest("hello");
    request.model = { provider: "anthropic", id: "x" };
    const viaBase = await collect(routed.run(request));
    expect(viaBase[0]).toEqual({ type: "text", text: "from base" });
    expect(routed.describe().id).toBe("base");
  });

  it("fails like a missing engine without a CLI runtime", () => {
    const routed = routeAgentRuntime(base(), undefined);
    expect(() => routed.run(cliRequest("hi"))).toThrow(
      "Claude Code isn't installed where this bot runs.",
    );
  });

  it("aborts both runtimes", async () => {
    const b = base();
    const cli = { ...base(), abort: vi.fn(async () => undefined) };
    await routeAgentRuntime(b, cli).abort("r");
    expect(b.abort).toHaveBeenCalledWith("r");
    expect(cli.abort).toHaveBeenCalledWith("r");
  });
});
