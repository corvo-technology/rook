import type { ConnectorStatus, ConnectorStatusId } from "./connector-status.js";
import { readConnectorStatus } from "./connector-status.js";

export const CONNECTOR_WAIT_LIMITS = {
  firstPauseMs: 2_000,
  maxPauseMs: 15_000,
  maxWaitMs: 300_000,
} as const;

export type ConnectorWaitLimits = Record<keyof typeof CONNECTOR_WAIT_LIMITS, number>;

/** Sleeps, and returns early without throwing when the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

export type ConnectorWaitOutcome =
  | { kind: "done"; result: unknown; polls: number; ms: number }
  | {
      kind: "time" | "status_error";
      result: unknown;
      status: ConnectorStatus;
      polls: number;
      ms: number;
      error?: string;
    }
  | { kind: "not_status" | "stopped"; result: unknown; polls: number; ms: number };

function isErrorResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  );
}

/** Ask a status tool again and again, with doubling pauses, until the work is no longer pending. */
export async function awaitConnectorResult(
  first: unknown,
  firstStatus: ConnectorStatus,
  args: Record<string, ConnectorStatusId>,
  poll: () => Promise<{ result: unknown } | { error: string }>,
  options: {
    limits: ConnectorWaitLimits;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    now: () => number;
    signal: AbortSignal;
    active: () => boolean;
    onFirstPause?: () => Promise<void>;
  },
): Promise<ConnectorWaitOutcome> {
  const { limits, signal } = options;
  const start = options.now();
  const elapsed = () => options.now() - start;
  const stopped = () => signal.aborted || !options.active();
  let current = first;
  let status = firstStatus;
  let polls = 0;
  let pause = limits.firstPauseMs;
  let paused = false;
  for (;;) {
    if (stopped()) return { kind: "stopped", result: current, polls, ms: elapsed() };
    const left = limits.maxWaitMs - elapsed();
    if (left <= 0) return { kind: "time", result: current, status, polls, ms: elapsed() };
    if (!paused) {
      paused = true;
      await options.onFirstPause?.();
    }
    await options.sleep(Math.min(pause, left), signal);
    pause = Math.min(pause * 2, limits.maxPauseMs);
    if (stopped()) return { kind: "stopped", result: current, polls, ms: elapsed() };
    const answer = await poll();
    polls++;
    if ("error" in answer) {
      return {
        kind: "status_error",
        result: current,
        status,
        polls,
        ms: elapsed(),
        error: answer.error,
      };
    }
    const next = answer.result;
    if (isErrorResult(next)) return { kind: "done", result: next, polls, ms: elapsed() };
    const read = readConnectorStatus(next);
    if (!read || Object.entries(args).some(([key, value]) => read.ids[key] !== value)) {
      return { kind: "not_status", result: first, polls, ms: elapsed() };
    }
    if (!read.pending) return { kind: "done", result: next, polls, ms: elapsed() };
    current = next;
    status = read;
  }
}

function took(ms: number): string {
  return ms < 60_000 ? `${Math.floor(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min`;
}

function idList(args: Record<string, ConnectorStatusId>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

/** The note the model reads when the backend stopped waiting. */
export function connectorWaitNote(
  outcome: Extract<ConnectorWaitOutcome, { kind: "time" | "status_error" }>,
  statusTool: string,
  args: Record<string, ConnectorStatusId>,
): string {
  const ids = idList(args);
  if (outcome.kind === "time") {
    return `Still ${outcome.status.state} after waiting ${took(outcome.ms)} (${outcome.polls} checks with ${statusTool}). Do not sleep or check in a loop: tell the person it is still running (${ids}) and continue with what you can, or call ${statusTool} once more before you finish.`;
  }
  return `${statusTool} failed while waiting (${outcome.error}). The last state was ${outcome.status.state} (${ids}). Do not sleep: continue with what you can, or call ${statusTool} once more before you finish.`;
}
