import { spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import { getLogger } from "@corvo/logging";

/**
 * Local speech engines are native code, and native code can crash the process it runs in. They
 * run in a child process of their own, so a crash costs the request in flight and nothing else:
 * the API keeps answering, and the next request starts a fresh child.
 *
 * The protocol is one message each way. The host sends `{ id, ...job }`; the child answers
 * `{ id, result }` or `{ id, error }`. Requests go one at a time, because the engine and the CPU
 * are shared, so a crash can only ever have one request in flight.
 */

/** The part of a child process the host uses; a real `ChildProcess` satisfies it. */
export interface SpeechChild extends EventEmitter {
  send(message: unknown): boolean;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface SpeechProcessOptions {
  /** Names the engine in logs and in the error a crash gives. */
  name: string;
  /** Starts a child. The default runs `script` on this program in node mode. */
  spawn: () => SpeechChild;
  /** A request that takes longer than this ends the child and fails. Loading a model counts. */
  timeoutMs: number;
  /** How long the child, and the models it holds, is kept after the last request. */
  idleMs: number;
  /** How long to wait before starting a child again after `crashes` crashes in a row. */
  backoffMs?: (crashes: number) => number;
}

type Reply = { id: number; result?: unknown; error?: string };

export const DEFAULT_BACKOFF_MS = (crashes: number) => Math.min(250 * 2 ** (crashes - 1), 5_000);

/** Runs `script` as a Node program that speaks the protocol over its IPC channel. */
export function spawnNodeChild(script: string, env: Record<string, string>): SpeechChild {
  // The desktop app's own binary is Electron; ELECTRON_RUN_AS_NODE makes it run as plain Node,
  // exactly as the engine that hosts the API does. Under Node the variable is ignored.
  return spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    // Structured clone, so samples travel as typed arrays and not as JSON.
    serialization: "advanced",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", ...env },
  });
}

/**
 * The child's side of the protocol, shared by every engine. `handler` is the source of
 * `function handle(job)`, which returns the result (or throws) and may keep models between jobs.
 */
export function childScript(handler: string): string {
  return `
const sherpa = require(process.env.CORVO_SPEECH_ENGINE);
const numThreads = Number(process.env.CORVO_SPEECH_THREADS) || 4;
process.on("disconnect", () => process.exit(0));
${handler}
process.on("message", (job) => {
  Promise.resolve()
    .then(() => handle(job))
    .then(
      (result) => process.send({ id: job.id, result }),
      (error) => process.send({ id: job.id, error: error && error.message ? error.message : String(error) }),
    );
});
`;
}

export class SpeechProcessError extends Error {
  constructor(
    message: string,
    readonly kind: "crashed" | "timeout" | "cancelled" | "failed",
  ) {
    super(message);
    this.name = "SpeechProcessError";
  }
}

export class SpeechProcess<Result> {
  private child: SpeechChild | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private nextId = 1;
  private tail: Promise<unknown> = Promise.resolve();
  private crashes = 0;
  private lastCrashAt = 0;
  private readonly backoffMs: (crashes: number) => number;

  constructor(private readonly options: SpeechProcessOptions) {
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  }

  /** Runs one job in the child, after the ones asked before it. */
  request(job: Record<string, unknown>, signal?: AbortSignal | undefined): Promise<Result> {
    const run = this.tail.then(() => this.runOne(job, signal));
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Ends the child. The next request starts a new one. */
  async close(): Promise<void> {
    clearTimeout(this.idleTimer);
    this.stop();
  }

  private stop() {
    const child = this.child;
    this.child = undefined;
    child?.removeAllListeners("exit");
    child?.removeAllListeners("message");
    child?.kill("SIGKILL");
  }

  private async runOne(job: Record<string, unknown>, signal?: AbortSignal): Promise<Result> {
    clearTimeout(this.idleTimer);
    const { name } = this.options;
    if (signal?.aborted) throw new SpeechProcessError(`${name} cancelled.`, "cancelled");
    const wait = this.lastCrashAt + this.backoffMs(this.crashes) - Date.now();
    if (this.crashes > 0 && !this.child && wait > 0) await this.delay(wait, signal);
    if (signal?.aborted) throw new SpeechProcessError(`${name} cancelled.`, "cancelled");
    const child = this.start();
    const id = this.nextId++;
    return new Promise<Result>((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const finish = () => {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        child.off("error", onError);
        signal?.removeEventListener("abort", onAbort);
        if (this.child === child) {
          this.idleTimer = setTimeout(() => this.stopIdle(child), this.options.idleMs);
          this.idleTimer.unref();
        }
      };
      const fail = (error: SpeechProcessError, endChild: boolean) => {
        finish();
        if (endChild && this.child === child) this.stop();
        reject(error);
      };
      const onMessage = (reply: Reply) => {
        if (reply?.id !== id) return;
        finish();
        if (reply.error !== undefined) {
          // The engine reported the failure itself, so the child is healthy and stays.
          this.crashes = 0;
          reject(new SpeechProcessError(`${name} failed: ${reply.error}`, "failed"));
          return;
        }
        this.crashes = 0;
        resolve(reply.result as Result);
      };
      const crashed = (reason: string) => {
        if (this.child === child) this.child = undefined;
        this.crashes += 1;
        this.lastCrashAt = Date.now();
        getLogger().error("local speech engine stopped", { engine: name, reason });
        fail(new SpeechProcessError(`${name} stopped unexpectedly (${reason}).`, "crashed"), false);
      };
      const onExit = (code: number | null, exitSignal: string | null) =>
        crashed(exitSignal ?? `exit code ${code}`);
      const onError = (error: Error) => crashed(error.message);
      const onAbort = () => {
        fail(new SpeechProcessError(`${name} cancelled.`, "cancelled"), true);
      };
      child.on("message", onMessage);
      child.on("exit", onExit);
      child.on("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        getLogger().warn("local speech engine timed out", { engine: name });
        fail(new SpeechProcessError(`${name} timed out.`, "timeout"), true);
      }, this.options.timeoutMs);
      try {
        child.send({ ...job, id });
      } catch (error) {
        crashed(error instanceof Error ? error.message : "could not send");
      }
    });
  }

  private start(): SpeechChild {
    if (this.child) return this.child;
    const child = this.options.spawn();
    this.child = child;
    // A child that dies between requests (or that never started) is noticed here, not at the
    // next request, so the next one starts a fresh child instead of writing to a dead one.
    child.on("exit", () => {
      if (this.child === child) this.child = undefined;
    });
    child.on("error", () => {
      if (this.child === child) this.child = undefined;
    });
    return child;
  }

  private stopIdle(child: SpeechChild) {
    if (this.child === child) this.stop();
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener("abort", done, { once: true });
    });
  }
}
