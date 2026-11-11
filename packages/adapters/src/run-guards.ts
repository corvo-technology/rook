import type { AgentToolExecutionObserver } from "@corvo/adapter-kit";
import type { TurnGuardKind } from "@corvo/contracts";
import { TURN_GUARD_RUN_ERRORS } from "@corvo/core";
import { isToolPauseResult } from "./approval-effect.js";
import { idleSleepSeconds } from "./idle-sleep.js";
import {
  newStallWatch,
  type StallWatch,
  stallBegin,
  stallEnd,
  stallSign,
  stallTick,
} from "./stall-watch.js";
import { toolResultError } from "./tool-completion-audit.js";
import {
  afterCall,
  beforeCall,
  type CallGuardState,
  newCallGuardState,
  resultFingerprint,
  TURN_GUARD_LIMITS,
  type TurnGuardLimits,
} from "./turn-guard-calls.js";

/** Why a run was ended by a guard. Its message is the fixed sentence saved as the run error. */
export class TurnGuardStopError extends Error {
  override readonly name = "TurnGuardStopError";
  constructor(readonly kind: TurnGuardKind) {
    super(TURN_GUARD_RUN_ERRORS[kind]);
  }
}

/** The guard state of one run attempt and its single stop path. */
export interface RunGuards {
  readonly limits: TurnGuardLimits;
  readonly calls: CallGuardState;
  readonly stall: StallWatch;
  readonly now: () => number;
  readonly stopped: TurnGuardKind | undefined;
  /** Rejects once a guard halts the run, so a stream that never ends cannot outlive the stop. */
  readonly stop: Promise<never>;
  halt(kind: TurnGuardKind, detail?: Record<string, string | number>): void;
  /** Records a sign of life. */
  sign(): void;
  dispose(): void;
}

export function createRunGuards(options: {
  abort: () => void;
  limits?: Partial<TurnGuardLimits>;
  now?: () => number;
  onHalt?: (kind: TurnGuardKind, detail: Record<string, string | number>) => void;
}): RunGuards {
  const limits: TurnGuardLimits = { ...TURN_GUARD_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const stall = newStallWatch(now());
  let stopped: TurnGuardKind | undefined;
  let disposed = false;
  let rejectStop: (error: TurnGuardStopError) => void = () => undefined;
  const stop = new Promise<never>((_, reject) => {
    rejectStop = reject;
  });
  stop.catch(() => undefined);
  const timer = setInterval(() => {
    if (stallTick(stall, now(), limits)) {
      guards.halt("stall", { "guard.silent_ms": now() - stall.lastSignAt });
    }
  }, limits.stallTickMs);
  timer.unref();

  const guards: RunGuards = {
    limits,
    calls: newCallGuardState(),
    stall,
    now,
    get stopped() {
      return stopped;
    },
    stop,
    halt(kind, detail = {}) {
      if (stopped || disposed) return;
      stopped = kind;
      options.onHalt?.(kind, detail);
      rejectStop(new TurnGuardStopError(kind));
      options.abort();
      clearInterval(timer);
    },
    sign() {
      stallSign(stall, now());
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
  return guards;
}

/** Adds a note for the model to a tool result without changing what the result says. */
export function withGuardNote(result: unknown, note: string): unknown {
  if (result && typeof result === "object") {
    const record = result as { content?: unknown };
    if (!Array.isArray(result) && Array.isArray(record.content)) {
      return { ...record, content: [...record.content, { type: "text", text: note }] };
    }
    if (!Array.isArray(result)) return { ...record, guard_note: note };
  }
  return { result, guard_note: note };
}

/** Runs one tool call through the call guards and the stall watch. */
export async function guardedToolCall(
  target: {
    guards: RunGuards;
    signal: AbortSignal;
    readOnlyConnectorTool: (name: string) => boolean;
  },
  name: string,
  args: Record<string, unknown>,
  observer: AgentToolExecutionObserver | undefined,
  run: (observer: AgentToolExecutionObserver | undefined) => Promise<unknown>,
): Promise<unknown> {
  const { guards } = target;
  const before = beforeCall(
    guards.calls,
    {
      name,
      counted: target.readOnlyConnectorTool(name),
      idleSleepSeconds:
        name === "shell" && typeof args.command === "string" ? idleSleepSeconds(args.command) : 0,
    },
    guards.limits,
  );
  if (before.action === "refuse") {
    if (before.stop) guards.halt(before.stop, { "guard.tool": name });
    return { error: before.text };
  }
  stallBegin(guards.stall, guards.now());
  try {
    const watched: AgentToolExecutionObserver = {
      ...observer,
      onShellStillRunning(completion) {
        observer?.onShellStillRunning?.(completion);
        stallBegin(guards.stall, guards.now());
        const end = () => stallEnd(guards.stall, guards.now());
        completion.then(end, end);
      },
    };
    let result: unknown;
    try {
      result = await run(watched);
    } catch (error) {
      if (!target.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        const after = afterCall(
          guards.calls,
          { name, args },
          { fingerprint: resultFingerprint(message), failed: true },
          guards.limits,
        );
        if (after.stop) guards.halt(after.stop, { "guard.tool": name });
      }
      throw error;
    }
    if (isToolPauseResult(result)) return result;
    const after = afterCall(
      guards.calls,
      { name, args },
      { fingerprint: resultFingerprint(result), failed: toolResultError(result) !== undefined },
      guards.limits,
    );
    if (after.stop) guards.halt(after.stop, { "guard.tool": name });
    const note = before.note ?? after.note;
    return note ? withGuardNote(result, note) : result;
  } finally {
    stallEnd(guards.stall, guards.now());
  }
}
