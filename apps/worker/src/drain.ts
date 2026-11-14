import { parsePositiveInteger } from "@corvo/db";

/** Long enough for most agent turns to finish after the last deploy signal. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 120_000;
/** After the deadline, runs get this long to save their state and hand themselves back. */
export const INTERRUPT_GRACE_MS = 15_000;

/**
 * The pod must be allowed to live at least this long after SIGTERM, or the platform
 * kills the worker before the drain and the hand-back finish.
 */
export function requiredTerminationGraceMs(drainTimeoutMs: number): number {
  return drainTimeoutMs + INTERRUPT_GRACE_MS + 15_000;
}

export function drainTimeoutFromEnv(env: NodeJS.ProcessEnv): number {
  return parsePositiveInteger(env.WORKER_DRAIN_TIMEOUT_MS, DEFAULT_DRAIN_TIMEOUT_MS);
}

export type DrainOutcome = "drained" | "interrupted" | "abandoned";

/**
 * Stop taking work and let what is running finish. `stop` must stop admission at once and
 * resolve when in-flight work ends. At the deadline `interrupt` tells the runs to save
 * their state and return to the queue, and they get a short grace to do so. Whatever is
 * left is recovered by the next worker once its lease expires.
 */
export async function drain(options: {
  stop: () => Promise<void>;
  interrupt: () => void;
  timeoutMs: number;
  interruptGraceMs?: number;
  log?: (message: string, fields?: Record<string, unknown>) => void;
}): Promise<DrainOutcome> {
  const log = options.log ?? (() => undefined);
  const stopped = options.stop().then(() => "drained" as const);
  // Surface a failing stop to the caller, never as an unhandled rejection.
  stopped.catch(() => undefined);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const waitFor = (ms: number) =>
    new Promise<"timeout">((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), ms);
      timers.add(timer);
    });
  try {
    if ((await Promise.race([stopped, waitFor(options.timeoutMs)])) === "drained") return "drained";
    log("worker drain deadline reached; interrupting runs", {
      "drain.timeout_ms": options.timeoutMs,
    });
    options.interrupt();
    const grace = options.interruptGraceMs ?? INTERRUPT_GRACE_MS;
    if ((await Promise.race([stopped, waitFor(grace)])) === "drained") return "interrupted";
    log("worker drain abandoned; runs will be recovered after their lease expires");
    return "abandoned";
  } finally {
    for (const timer of timers) clearTimeout(timer);
  }
}
