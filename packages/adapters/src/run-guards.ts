import type { AgentToolExecutionObserver } from "@corvo/adapter-kit";
import type { TurnGuardKind } from "@corvo/contracts";
import { TURN_GUARD_RUN_ERRORS } from "@corvo/core";
import { isToolPauseResult } from "./approval-effect.js";
import {
  EMPTY_GUARD_STATE,
  type RunGuardState,
  restoreCallState,
  saveCallState,
} from "./guard-state.js";
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
  /** Set when the attempt ends waiting for a person: their answer is progress, so loop counters restart. */
  humanWait: boolean;
  /** Called after each tool call finishes, a safe point to save the counters. */
  onStepEnd?: () => void;
  halt(kind: TurnGuardKind, detail?: Record<string, string | number>): void;
  /** Counts one tool-call step against the run totals. True when that stopped the run. */
  step(): boolean;
  /** Time the run has been active over every attempt so far. */
  activeMs(): number;
  /** What to save so the next attempt of this run continues these counters. */
  snapshot(open: boolean): RunGuardState;
  /** Records a sign of life. */
  sign(): void;
  dispose(): void;
}

export function createRunGuards(options: {
  abort: () => void;
  limits?: Partial<TurnGuardLimits>;
  now?: () => number;
  /** What earlier attempts of this run saved. */
  restored?: RunGuardState;
  /** Tokens the run has spent, to tell a connection that reports no usage from one that does. */
  tokensSpent?: () => number;
  onHalt?: (kind: TurnGuardKind, detail: Record<string, string | number>) => void;
}): RunGuards {
  const limits: TurnGuardLimits = { ...TURN_GUARD_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  const stall = newStallWatch(now());
  const startedAt = now();
  const restored = options.restored ?? EMPTY_GUARD_STATE;
  const totals = {
    steps: restored.steps,
    before: restored.activeMs,
    // An attempt that never reached a clean exit died with its worker.
    crashes: restored.open ? restored.crashes + 1 : 0,
  };
  const activeMs = () => totals.before + Math.max(0, now() - startedAt);
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
    } else if (activeMs() > limits.runActiveMs) {
      guards.halt("loop", { "guard.active_ms": activeMs() });
    }
  }, limits.stallTickMs);
  timer.unref();

  const guards: RunGuards = {
    limits,
    calls: restoreCallState(restored.calls),
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
    humanWait: false,
    step() {
      totals.steps += 1;
      const unmetered = options.tokensSpent !== undefined && options.tokensSpent() === 0;
      if (
        totals.steps > limits.runStepsStop ||
        (unmetered && totals.steps > limits.unmeteredStepsStop)
      ) {
        guards.halt("loop", { "guard.steps": totals.steps });
      }
      return stopped !== undefined;
    },
    activeMs,
    snapshot(open) {
      // A person answering is progress: loop counters restart, the run totals do not.
      const fresh = guards.humanWait && !open;
      return {
        steps: totals.steps,
        activeMs: activeMs(),
        crashes: open ? totals.crashes : 0,
        open,
        calls: fresh ? EMPTY_GUARD_STATE.calls : saveCallState(guards.calls),
      };
    },
    sign() {
      stallSign(stall, now());
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
  if (totals.crashes >= limits.crashLoopStop)
    guards.halt("stall", { "guard.crashes": totals.crashes });
  else if (totals.steps >= limits.runStepsStop || activeMs() > limits.runActiveMs) {
    guards.halt("loop", { "guard.steps": totals.steps, "guard.active_ms": activeMs() });
  }
  return guards;
}

/** Read by the model, not shown as UI. */
const RUN_LIMIT_REFUSAL = "Not run: this run reached its limit. Say what is left.";

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
  if (guards.step()) return { error: RUN_LIMIT_REFUSAL };
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
    guards.onStepEnd?.();
    const note = before.note ?? after.note;
    return note ? withGuardNote(result, note) : result;
  } finally {
    stallEnd(guards.stall, guards.now());
  }
}
