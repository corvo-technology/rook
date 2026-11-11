import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_KEYS, LoginTerminal } from "./login-terminal.js";

afterEach(() => vi.useRealTimers());

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn() };
  child.kill = vi.fn();
  return child;
}

function setup(
  options: {
    binary?: string;
    script?: string | undefined;
    platform?: NodeJS.Platform;
    ready?: () => boolean;
  } = {},
) {
  const children: ReturnType<typeof fakeChild>[] = [];
  const spawn = vi.fn(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  const terminal = new LoginTerminal({
    spawn: spawn as never,
    binary: async () => options.binary ?? "/bin/claude",
    env: () => ({ HOME: "/home/test" }),
    status: {
      refresh: vi.fn(async () => ({
        enabled: true,
        engines: [
          {
            id: "claude" as const,
            state: options.ready?.() ? ("ready" as const) : ("signed_out" as const),
            version: "2.5.0",
            models: [],
            checkedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      })),
    },
    script: async () => ("script" in options ? options.script : "/usr/bin/script"),
    platform: options.platform ?? "linux",
    pollMs: 1_000,
    timeoutMs: 10_000,
  });
  return { terminal, spawn, children };
}

describe("LoginTerminal", () => {
  it("the Linux command string is constant whatever the binary path", async () => {
    const hostile = '/tmp/x"; rm -rf ~';
    const { terminal, spawn } = setup({ binary: hostile });
    await terminal.start("claude");
    const [file, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; shell: boolean },
    ];
    expect(file).toBe("/usr/bin/script");
    expect(args).toEqual(["-qfec", 'exec "$CORVO_LOGIN_BIN" auth login', "/dev/null"]);
    expect(options.env.CORVO_LOGIN_BIN).toBe(hostile);
    expect(options.shell).toBe(false);
  });

  it("passes the binary as an argument on macOS", async () => {
    const { terminal, spawn } = setup({ platform: "darwin" });
    await terminal.start("claude");
    expect((spawn.mock.calls[0] as unknown as unknown[])[1]).toEqual([
      "-q",
      "/dev/null",
      "/bin/claude",
      "auth",
      "login",
    ]);
  });

  it("shows the screen as text lines", async () => {
    const { terminal, children } = setup();
    const started = await terminal.start("claude");
    children[0]?.stdout.emit(
      "data",
      Buffer.from("\u001b[1mOpen this page\u001b[0m\r\nCode: ABCD\r\n"),
    );
    expect(terminal.screen(started?.sessionId ?? "")).toEqual({
      state: "running",
      lines: ["Open this page", "Code: ABCD"],
    });
  });

  it("input strips newlines and sends keys from the fixed set", async () => {
    const { terminal, children } = setup();
    const started = await terminal.start("claude");
    terminal.input(started?.sessionId ?? "", { text: "ab\r\ncd\n" });
    terminal.input(started?.sessionId ?? "", { key: "enter" });
    expect(children[0]?.stdin.write.mock.calls).toEqual([["abcd"], [LOGIN_KEYS.enter]]);
  });

  it("is done when status reports signed in", async () => {
    vi.useFakeTimers();
    let ready = false;
    const { terminal } = setup({ ready: () => ready });
    const started = await terminal.start("claude");
    ready = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(terminal.screen(started?.sessionId ?? "")?.state).toBe("done");
  });

  it("returns undefined when script is missing", async () => {
    const { terminal, spawn } = setup({ script: undefined });
    expect(await terminal.start("claude")).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("ignores input after the session is done", async () => {
    const { terminal, children } = setup();
    const started = await terminal.start("claude");
    terminal.cancel(started?.sessionId ?? "");
    terminal.input(started?.sessionId ?? "", { text: "late" });
    expect(children[0]?.stdin.write).not.toHaveBeenCalled();
    expect(terminal.screen(started?.sessionId ?? "")?.state).toBe("cancelled");
  });
});
