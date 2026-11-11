import type { ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { CliEngineId, CliEnginesView } from "@corvo/contracts";
import { killProcessTree } from "../bounded-process.js";

/** The CLI's own sign-in command, as an argument array. */
export const BROWSER_LOGIN_ARGS: Record<CliEngineId, readonly string[]> = {
  claude: ["auth", "login"],
};

/** Whether the engine is signed in is read from the same status check the model catalog uses. */
export type CliEngineStatusSource = { refresh(): Promise<CliEnginesView> };

export type BrowserLoginState = {
  state: "running" | "done" | "failed" | "cancelled";
  url?: string;
  error?: string;
};

type Session = {
  id: string;
  engine: CliEngineId;
  child: ChildProcess;
  state: BrowserLoginState;
  poll: ReturnType<typeof setInterval>;
  timeout: ReturnType<typeof setTimeout>;
};

const URL_PATTERN = /https:\/\/[^\s"'<>]+/;
const SCAN_TAIL_CHARS = 4_096;
const DEFAULT_POLL_MS = 4_000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

/**
 * Signs a CLI in on the owner's computer: runs its own login, which opens the system browser
 * and finishes on the CLI's own callback, then polls the status check until it is signed in.
 * Its output is read only for the first https address, so the page can offer to open it again.
 * Nothing it prints is stored. One session runs at a time.
 */
export class BrowserLogin {
  readonly #deps: {
    spawn: typeof nodeSpawn;
    binary: (id: CliEngineId) => Promise<string | undefined>;
    env: (id: CliEngineId) => NodeJS.ProcessEnv;
    status: CliEngineStatusSource;
    pollMs: number;
    timeoutMs: number;
  };
  #session: Session | undefined;
  readonly #finished = new Map<string, BrowserLoginState>();

  constructor(deps: {
    spawn: typeof nodeSpawn;
    binary: (id: CliEngineId) => Promise<string | undefined>;
    env: (id: CliEngineId) => NodeJS.ProcessEnv;
    status: CliEngineStatusSource;
    pollMs?: number;
    timeoutMs?: number;
  }) {
    this.#deps = {
      ...deps,
      pollMs: deps.pollMs ?? DEFAULT_POLL_MS,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  async start(id: CliEngineId): Promise<{ sessionId: string }> {
    if (this.#session) this.#end(this.#session, { state: "cancelled" });
    const binary = await this.#deps.binary(id);
    if (!binary) throw new Error("The CLI is not installed.");
    const child = this.#deps.spawn(binary, [...BROWSER_LOGIN_ARGS[id]], {
      env: this.#deps.env(id),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const session: Session = {
      id: randomUUID(),
      engine: id,
      child,
      state: { state: "running" },
      poll: setInterval(() => void this.#check(session), this.#deps.pollMs),
      timeout: setTimeout(
        () => this.#end(session, { state: "failed", error: "Sign-in timed out." }),
        this.#deps.timeoutMs,
      ),
    };
    session.poll.unref?.();
    session.timeout.unref?.();
    this.#session = session;
    let tail = "";
    const scan = (chunk: Buffer) => {
      if (session.state.url) return;
      tail = (tail + chunk.toString("utf8")).slice(-SCAN_TAIL_CHARS);
      const url = tail.match(URL_PATTERN)?.[0];
      if (url) {
        session.state = { ...session.state, url };
        tail = "";
      }
    };
    child.stdout?.on("data", scan);
    child.stderr?.on("data", scan);
    child.once("error", () =>
      this.#end(session, { state: "failed", error: "Sign-in could not start." }),
    );
    child.once("close", () => void this.#check(session, true));
    return { sessionId: session.id };
  }

  state(sessionId: string): BrowserLoginState | undefined {
    if (this.#session?.id === sessionId) return this.#session.state;
    return this.#finished.get(sessionId);
  }

  cancel(sessionId: string): void {
    if (this.#session?.id === sessionId) this.#end(this.#session, { state: "cancelled" });
  }

  async #check(session: Session, exited = false): Promise<void> {
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
    if (signedIn) this.#end(session, { state: "done" });
    else if (exited) this.#end(session, { state: "failed", error: "Sign-in did not finish." });
  }

  #end(session: Session, outcome: BrowserLoginState): void {
    if (this.#session !== session) return;
    clearInterval(session.poll);
    clearTimeout(session.timeout);
    killProcessTree(session.child);
    this.#session = undefined;
    this.#finished.set(session.id, outcome);
    // Only the last few outcomes are kept, so a page can read the end of a finished session.
    if (this.#finished.size > 8) {
      const oldest = this.#finished.keys().next().value;
      if (oldest) this.#finished.delete(oldest);
    }
  }
}
