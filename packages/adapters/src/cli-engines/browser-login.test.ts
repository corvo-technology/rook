import { EventEmitter } from "node:events";
import type { CliEngineStatus } from "@corvo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserLogin } from "./browser-login.js";

afterEach(() => vi.useRealTimers());

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    pid: undefined;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function setup(state: () => CliEngineStatus["state"] = () => "signed_out") {
  const children: ReturnType<typeof fakeChild>[] = [];
  const spawn = vi.fn(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  const status = {
    refresh: vi.fn(async () => ({
      enabled: true,
      engines: [
        {
          id: "claude" as const,
          state: state(),
          version: "2.5.0",
          models: [],
          checkedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    })),
  };
  const login = new BrowserLogin({
    spawn: spawn as never,
    binary: async () => "/bin/claude",
    env: () => ({ HOME: "/home/test" }),
    status,
    pollMs: 1_000,
    timeoutMs: 10_000,
  });
  return { login, spawn, children, status };
}

describe("BrowserLogin", () => {
  it("runs the CLI's own login as an argument array", async () => {
    const { login, spawn } = setup();
    await login.start("claude");
    expect(spawn).toHaveBeenCalledWith(
      "/bin/claude",
      ["auth", "login"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("is done when status reports signed in, and the process is killed", async () => {
    vi.useFakeTimers();
    let current: CliEngineStatus["state"] = "signed_out";
    const { login, children } = setup(() => current);
    const { sessionId } = await login.start("claude");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(login.state(sessionId)?.state).toBe("running");
    current = "ready";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(login.state(sessionId)?.state).toBe("done");
    expect(children[0]?.kill).toHaveBeenCalled();
  });

  it("fails after the timeout", async () => {
    vi.useFakeTimers();
    const { login } = setup();
    const { sessionId } = await login.start("claude");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(login.state(sessionId)).toEqual({ state: "failed", error: "Sign-in timed out." });
  });

  it("a second start cancels the first", async () => {
    const { login, children } = setup();
    const first = await login.start("claude");
    const second = await login.start("claude");
    expect(login.state(first.sessionId)?.state).toBe("cancelled");
    expect(login.state(second.sessionId)?.state).toBe("running");
    expect(children[0]?.kill).toHaveBeenCalled();
  });

  it("offers an https address only", async () => {
    const { login, children } = setup();
    const { sessionId } = await login.start("claude");
    children[0]?.stdout.emit("data", Buffer.from("open http://insecure.test/x first\n"));
    expect(login.state(sessionId)?.url).toBeUndefined();
    children[0]?.stdout.emit(
      "data",
      Buffer.from("or visit https://login.test/auth?code=abc now\n"),
    );
    expect(login.state(sessionId)?.url).toBe("https://login.test/auth?code=abc");
  });

  it("fails when the CLI exits without being signed in", async () => {
    const { login, children } = setup();
    const { sessionId } = await login.start("claude");
    children[0]?.emit("close", 1);
    await vi.waitFor(() => expect(login.state(sessionId)?.state).toBe("failed"));
  });
});
