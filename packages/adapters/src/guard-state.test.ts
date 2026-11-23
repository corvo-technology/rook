import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGuardState } from "./guard-state.js";
import { createRunGuards, guardedToolCall, type RunGuards } from "./run-guards.js";
import { TURN_GUARD_LIMITS } from "./turn-guard-calls.js";

const HOUR = 3_600_000;
const open: RunGuards[] = [];

function attempt(saved?: unknown, options: { tokensSpent?: () => number } = {}) {
  const guards = createRunGuards({
    abort: () => undefined,
    now: () => Date.now(),
    restored: saved === undefined ? undefined : parseGuardState(saved),
    ...options,
  });
  open.push(guards);
  return guards;
}

const run = (guards: RunGuards, name: string, result: unknown) =>
  guardedToolCall(
    { guards, signal: new AbortController().signal, readOnlyConnectorTool: () => false },
    name,
    {},
    undefined,
    async () => result,
  );

/** What the database column holds: JSON, so the round trip is the real one. */
const saved = (guards: RunGuards, isOpen: boolean) =>
  JSON.parse(JSON.stringify(guards.snapshot(isOpen)));

describe("run guards across attempts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const guards of open.splice(0)) guards.dispose();
    vi.useRealTimers();
  });

  it("keeps the failure streak and repeat counts after a re-claim", async () => {
    const first = attempt();
    for (let i = 0; i < TURN_GUARD_LIMITS.errorsStop - 1; i++) {
      await run(first, `tool${i}`, { error: "boom" });
    }
    const second = attempt(saved(first, true));
    expect(second.stopped).toBeUndefined();
    await run(second, "last", { error: "boom" });
    expect(second.stopped).toBe("tool_errors");
  });

  it("carries identical-result repeats into the next attempt", async () => {
    const first = attempt();
    for (let i = 0; i < TURN_GUARD_LIMITS.repeatStop - 1; i++) await run(first, "read", "same");
    const second = attempt(saved(first, true));
    await run(second, "read", "same");
    expect(second.stopped).toBe("loop");
  });

  it("restarts loop counters when the attempt waited for a person, not the run totals", async () => {
    const first = attempt();
    for (let i = 0; i < TURN_GUARD_LIMITS.errorsStop - 1; i++) {
      await run(first, `tool${i}`, { error: "boom" });
    }
    first.humanWait = true;
    const state = saved(first, false);
    expect(state.calls.failing).toBe(0);
    expect(state.steps).toBe(TURN_GUARD_LIMITS.errorsStop - 1);
    const second = attempt(state);
    await run(second, "after", { error: "boom" });
    expect(second.stopped).toBeUndefined();
  });

  it("stops at the step cap summed over attempts", async () => {
    const first = attempt({ steps: TURN_GUARD_LIMITS.runStepsStop - 1 });
    expect(first.stopped).toBeUndefined();
    await run(first, "a", "1");
    expect(first.stopped).toBeUndefined();
    await run(first, "b", "2");
    expect(first.stopped).toBe("loop");
    expect(attempt(saved(first, false)).stopped).toBe("loop");
  });

  it("stops at the active time cap summed over attempts, never counting the wait between", async () => {
    const first = attempt();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    first.humanWait = true;
    const state = saved(first, false);
    // The run then waits a day for a person; none of it is active time.
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    const second = attempt(state);
    expect(second.stopped).toBeUndefined();
    // Signs of life keep the stall guard quiet, so only the time cap can stop it.
    for (let i = 0; i < 13 && !second.stopped; i++) {
      second.sign();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    }
    expect(second.stopped).toBe("loop");
    expect(second.activeMs()).toBeGreaterThan(TURN_GUARD_LIMITS.runActiveMs);
  });

  it("stops a run whose attempts keep ending without a clean exit", () => {
    let state: unknown;
    for (let i = 0; i < TURN_GUARD_LIMITS.crashLoopStop; i++) {
      const guards = attempt(state);
      expect(guards.stopped).toBeUndefined();
      state = saved(guards, true);
    }
    expect(attempt(state).stopped).toBe("stall");
  });

  it("does not count a clean exit as a crash", () => {
    let state: unknown;
    for (let i = 0; i < TURN_GUARD_LIMITS.crashLoopStop + 2; i++) {
      const guards = attempt(state);
      expect(guards.stopped).toBeUndefined();
      state = saved(guards, false);
    }
  });

  it("applies the stricter step cap when no tokens are reported", async () => {
    const metered = attempt(
      { steps: TURN_GUARD_LIMITS.unmeteredStepsStop },
      { tokensSpent: () => 9 },
    );
    await run(metered, "a", "1");
    expect(metered.stopped).toBeUndefined();
    const unmetered = attempt(
      { steps: TURN_GUARD_LIMITS.unmeteredStepsStop },
      { tokensSpent: () => 0 },
    );
    await run(unmetered, "a", "1");
    expect(unmetered.stopped).toBe("loop");
  });

  it("reads an unreadable column as nothing saved", () => {
    for (const value of [null, "x", 3, [], { steps: "many", calls: { repeats: "no" } }]) {
      expect(parseGuardState(value).steps).toBe(0);
      expect(attempt(value).stopped).toBeUndefined();
    }
  });
});
