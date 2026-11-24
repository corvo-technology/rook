import { type CallGuardState, newCallGuardState } from "./turn-guard-calls.js";

/** Most repeat keys kept when saving, newest last, so the saved state stays small. */
const SAVED_REPEAT_KEYS = 64;

/** What the guards keep across attempts of one run (saved in `runs.guardState`). */
export type RunGuardState = {
  /** Tool-call steps over every attempt. */
  steps: number;
  /** Time spent running over every attempt; waiting for a person is never in it. */
  activeMs: number;
  /** Consecutive attempts that ended without a clean exit. */
  crashes: number;
  /** True while an attempt is running; a state still open when the next attempt starts is a crash. */
  open: boolean;
  calls: {
    repeats: Array<[string, { fingerprint: string; count: number }]>;
    failing: number;
    perTool: Array<[string, number]>;
    refusedCalls: number;
    idleSleeps: number;
    refusedSleeps: number;
  };
};

export const EMPTY_GUARD_STATE: RunGuardState = {
  steps: 0,
  activeMs: 0,
  crashes: 0,
  open: false,
  calls: {
    repeats: [],
    failing: 0,
    perTool: [],
    refusedCalls: 0,
    idleSleeps: 0,
    refusedSleeps: 0,
  },
};

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Reads the saved column; anything unreadable counts as nothing saved. */
export function parseGuardState(value: unknown): RunGuardState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_GUARD_STATE;
  const record = value as Record<string, unknown>;
  const calls = (record.calls && typeof record.calls === "object" ? record.calls : {}) as Record<
    string,
    unknown
  >;
  const repeats: RunGuardState["calls"]["repeats"] = [];
  for (const entry of Array.isArray(calls.repeats) ? calls.repeats : []) {
    const [key, item] = Array.isArray(entry) ? entry : [];
    const fingerprint = item?.fingerprint;
    if (typeof key === "string" && typeof fingerprint === "string") {
      repeats.push([key, { fingerprint, count: count(item.count) }]);
    }
  }
  const perTool: RunGuardState["calls"]["perTool"] = [];
  for (const entry of Array.isArray(calls.perTool) ? calls.perTool : []) {
    const [name, n] = Array.isArray(entry) ? entry : [];
    if (typeof name === "string") perTool.push([name, count(n)]);
  }
  return {
    steps: count(record.steps),
    activeMs: count(record.activeMs),
    crashes: count(record.crashes),
    open: record.open === true,
    calls: {
      repeats,
      failing: count(calls.failing),
      perTool,
      refusedCalls: count(calls.refusedCalls),
      idleSleeps: count(calls.idleSleeps),
      refusedSleeps: count(calls.refusedSleeps),
    },
  };
}

export function restoreCallState(saved: RunGuardState["calls"]): CallGuardState {
  const state = newCallGuardState();
  state.repeats = new Map(saved.repeats);
  state.perTool = new Map(saved.perTool);
  state.failing = saved.failing;
  state.refusedCalls = saved.refusedCalls;
  state.idleSleeps = saved.idleSleeps;
  state.refusedSleeps = saved.refusedSleeps;
  return state;
}

export function saveCallState(state: CallGuardState): RunGuardState["calls"] {
  return {
    repeats: [...state.repeats].slice(-SAVED_REPEAT_KEYS),
    failing: state.failing,
    perTool: [...state.perTool],
    refusedCalls: state.refusedCalls,
    idleSleeps: state.idleSleeps,
    refusedSleeps: state.refusedSleeps,
  };
}
