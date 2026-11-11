import { createHash } from "node:crypto";
import type { TurnGuardKind } from "@corvo/contracts";

export const TURN_GUARD_LIMITS = {
  repeatWarn: 3,
  repeatStop: 5,
  errorsStop: 8,
  sameToolWarn: 15,
  sameToolStop: 60,
  refusedStop: 4,
  idleSleepMinSeconds: 20,
  idleSleepsFree: 1,
  stallMs: 1_200_000,
  stallTickMs: 15_000,
} as const;
export type TurnGuardLimits = Record<keyof typeof TURN_GUARD_LIMITS, number>;

const MAX_REPEAT_KEYS = 512;

const repeatNote = (limits: TurnGuardLimits) =>
  `This call has now returned the same result ${limits.repeatWarn} times. Repeating it will not change anything: try a different approach, or finish and say where you got stuck.`;
export const REPEAT_NOTE = repeatNote(TURN_GUARD_LIMITS);

export const sameToolNote = (name: string, limits: TurnGuardLimits = TURN_GUARD_LIMITS) =>
  `You have called ${name} ${limits.sameToolWarn} times in this run. Ask for less at a time (a search or a filter) instead of reading everything.`;
export const sameToolRefusal = (name: string, limits: TurnGuardLimits = TURN_GUARD_LIMITS) =>
  `Refused: ${name} has been called ${limits.sameToolStop} times in this run. Work with what you already have and say what is left.`;
export const IDLE_SLEEP_REFUSAL =
  "Not run: sleeping without checking anything does not make a result arrive sooner. To wait for something on the computer, sleep and check in the same command. Otherwise continue with what you have, or finish and say what is still pending.";

/** JSON with object keys sorted at every depth and `undefined` members dropped. */
export function canonicalArgs(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item ?? null));
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

/** A hash of the result, so a large result is never held and equal results compare equal. */
export function resultFingerprint(result: unknown): string {
  return createHash("sha256")
    .update(typeof result === "string" ? result : canonicalArgs(result))
    .digest("hex");
}

export interface CallGuardState {
  repeats: Map<string, { fingerprint: string; count: number }>;
  failing: number;
  perTool: Map<string, number>;
  refusedCalls: number;
  idleSleeps: number;
  refusedSleeps: number;
}

export function newCallGuardState(): CallGuardState {
  return {
    repeats: new Map(),
    failing: 0,
    perTool: new Map(),
    refusedCalls: 0,
    idleSleeps: 0,
    refusedSleeps: 0,
  };
}

export function beforeCall(
  state: CallGuardState,
  call: { name: string; counted: boolean; idleSleepSeconds: number },
  limits: TurnGuardLimits,
): { action: "run"; note?: string } | { action: "refuse"; text: string; stop?: TurnGuardKind } {
  if (call.idleSleepSeconds >= limits.idleSleepMinSeconds) {
    state.idleSleeps += 1;
    if (state.idleSleeps > limits.idleSleepsFree) {
      state.refusedSleeps += 1;
      return {
        action: "refuse",
        text: IDLE_SLEEP_REFUSAL,
        ...(state.refusedSleeps >= limits.refusedStop ? { stop: "waiting" as const } : {}),
      };
    }
  }
  if (!call.counted) return { action: "run" };
  const count = (state.perTool.get(call.name) ?? 0) + 1;
  state.perTool.set(call.name, count);
  if (count > limits.sameToolStop) {
    state.refusedCalls += 1;
    return {
      action: "refuse",
      text: sameToolRefusal(call.name, limits),
      ...(state.refusedCalls >= limits.refusedStop ? { stop: "loop" as const } : {}),
    };
  }
  return count === limits.sameToolWarn
    ? { action: "run", note: sameToolNote(call.name, limits) }
    : { action: "run" };
}

export function afterCall(
  state: CallGuardState,
  call: { name: string; args: unknown },
  outcome: { fingerprint: string; failed: boolean },
  limits: TurnGuardLimits,
): { note?: string; stop?: TurnGuardKind } {
  state.failing = outcome.failed ? state.failing + 1 : 0;
  const key = `${call.name} ${canonicalArgs(call.args)}`;
  const previous = state.repeats.get(key);
  const count = previous && previous.fingerprint === outcome.fingerprint ? previous.count + 1 : 1;
  // Re-inserting keeps the map in recency order, so the oldest key is the first one.
  state.repeats.delete(key);
  state.repeats.set(key, { fingerprint: outcome.fingerprint, count });
  if (state.repeats.size > MAX_REPEAT_KEYS) {
    const oldest = state.repeats.keys().next().value;
    if (oldest !== undefined) state.repeats.delete(oldest);
  }
  if (count >= limits.repeatStop) return { stop: "loop" };
  if (state.failing >= limits.errorsStop) return { stop: "tool_errors" };
  return count === limits.repeatWarn ? { note: repeatNote(limits) } : {};
}
