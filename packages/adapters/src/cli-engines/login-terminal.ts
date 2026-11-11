import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CliEngineId } from "@corvo/contracts";
import { VtScreen } from "@corvo/core";
import { killProcessTree } from "../bounded-process.js";
import { BROWSER_LOGIN_ARGS, type CliEngineStatusSource } from "./browser-login.js";

/** The fixed set of keys a page may send, as the bytes a terminal sends for them. */
export const LOGIN_KEYS = {
  enter: "\r",
  up: "\u001b[A",
  down: "\u001b[B",
  esc: "\u001b",
  tab: "\t",
  backspace: "\u007f",
} as const;

export type LoginTerminalState = "running" | "done" | "failed" | "cancelled";
export type LoginScreen = { state: LoginTerminalState; lines: string[]; error?: string };

const COLS = 100;
const ROWS = 30;
const MAX_TEXT_CHARS = 2_000;
const DEFAULT_POLL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

type Session = {
  id: string;
  engine: CliEngineId;
  child: ChildProcess;
  screen: VtScreen;
  state: LoginTerminalState;
  error?: string;
  poll: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
};

/**
 * Signs a CLI in on a server that has no browser: runs its login in a pseudo-terminal made by
 * the system `script` command, shows its screen as text lines, and passes typed text and a
 * fixed key set back. Nothing is stored or logged; a device code only passes through.
 */
export class LoginTerminal {
  readonly #deps: {
    spawn: typeof nodeSpawn;
    binary: (id: CliEngineId) => Promise<string | undefined>;
    env: (id: CliEngineId) => NodeJS.ProcessEnv;
    status: CliEngineStatusSource;
    script: () => Promise<string | undefined>;
    platform: NodeJS.Platform;
    pollMs: number;
    timeoutMs: number;
  };
  #session: Session | undefined;
  readonly #ended = new Map<string, LoginScreen>();

  constructor(deps: {
    spawn: typeof nodeSpawn;
    binary: (id: CliEngineId) => Promise<string | undefined>;
    env: (id: CliEngineId) => NodeJS.ProcessEnv;
    status: CliEngineStatusSource;
    /** Where the system `script` command is, or undefined when this computer has none. */
    script: () => Promise<string | undefined>;
    platform?: NodeJS.Platform;
    pollMs?: number;
    timeoutMs?: number;
  }) {
    this.#deps = {
      ...deps,
      platform: deps.platform ?? process.platform,
      pollMs: deps.pollMs ?? DEFAULT_POLL_MS,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  async start(id: CliEngineId): Promise<{ sessionId: string } | undefined> {
    const script = await this.#deps.script();
    const binary = await this.#deps.binary(id);
    if (!script || !binary) return undefined;
    if (this.#session) this.#end(this.#session, "cancelled");
    const login = [...BROWSER_LOGIN_ARGS[id]];
    // The binary path travels only in the environment, so the command string is a constant.
    const env = {
      ...this.#deps.env(id),
      TERM: "xterm",
      COLUMNS: String(COLS),
      LINES: String(ROWS),
    };
    const child =
      this.#deps.platform === "darwin"
        ? this.#deps.spawn(script, ["-q", "/dev/null", binary, ...login], this.#options(env))
        : this.#deps.spawn(
            script,
            ["-qfec", `exec "$CORVO_LOGIN_BIN" ${login.join(" ")}`, "/dev/null"],
            this.#options({ ...env, CORVO_LOGIN_BIN: binary }),
          );
    const session: Session = {
      id: randomUUID(),
      engine: id,
      child,
      screen: new VtScreen(COLS, ROWS),
      state: "running",
      poll: setInterval(() => void this.#check(session, false), this.#deps.pollMs),
      timeout: setTimeout(
        () => this.#end(session, "failed", "Sign-in timed out."),
        this.#deps.timeoutMs,
      ),
    };
    session.poll.unref?.();
    session.timeout.unref?.();
    this.#session = session;
    const feed = (chunk: Buffer) => session.screen.write(chunk.toString("utf8"));
    child.stdout?.on("data", feed);
    child.stderr?.on("data", feed);
    child.once("error", () => this.#end(session, "failed", "Sign-in could not start."));
    child.once("close", () => void this.#check(session, true));
    return { sessionId: session.id };
  }

  screen(sessionId: string): LoginScreen | undefined {
    const session = this.#session;
    if (session?.id === sessionId) {
      return { state: session.state, lines: session.screen.lines() };
    }
    return this.#ended.get(sessionId);
  }

  input(sessionId: string, input: { text?: string; key?: keyof typeof LOGIN_KEYS }): void {
    const session = this.#session;
    if (!session || session.id !== sessionId || session.state !== "running") return;
    // Newlines would submit what was typed; only the Enter key may do that.
    const text = input.text?.replace(/[\r\n]/g, "").slice(0, MAX_TEXT_CHARS) ?? "";
    const key = input.key ? LOGIN_KEYS[input.key] : "";
    if (text || key) session.child.stdin?.write(text + key);
  }

  cancel(sessionId: string): void {
    if (this.#session?.id === sessionId) this.#end(this.#session, "cancelled");
  }

  #options(env: NodeJS.ProcessEnv) {
    return {
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
      detached: this.#deps.platform !== "win32",
      windowsHide: true,
    };
  }

  async #check(session: Session, exited: boolean): Promise<void> {
    if (this.#session !== session) return;
    let signedIn = false;
    try {
      const view = await this.#deps.status.refresh();
      signedIn = view.engines.some(
        (engine) => engine.id === session.engine && engine.state === "ready",
      );
    } catch {
      signedIn = false;
    }
    if (this.#session !== session) return;
    if (signedIn) this.#end(session, "done");
    else if (exited) this.#end(session, "failed", "Sign-in did not finish.");
  }

  #end(session: Session, state: LoginTerminalState, error?: string): void {
    if (this.#session !== session) return;
    clearInterval(session.poll);
    clearTimeout(session.timeout);
    killProcessTree(session.child);
    this.#session = undefined;
    // The last screen is kept in memory only, so the page can read how the session ended.
    this.#ended.set(session.id, {
      state,
      lines: session.screen.lines(),
      ...(error ? { error } : {}),
    });
    if (this.#ended.size > 8) {
      const oldest = this.#ended.keys().next().value;
      if (oldest) this.#ended.delete(oldest);
    }
  }
}
