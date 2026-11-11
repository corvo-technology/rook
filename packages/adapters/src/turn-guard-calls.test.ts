import { describe, expect, it } from "vitest";
import {
  afterCall,
  beforeCall,
  canonicalArgs,
  IDLE_SLEEP_REFUSAL,
  newCallGuardState,
  REPEAT_NOTE,
  resultFingerprint,
  TURN_GUARD_LIMITS,
} from "./turn-guard-calls.js";

const limits = { ...TURN_GUARD_LIMITS };
const ok = (fingerprint = "same") => ({ fingerprint, failed: false });

describe("canonicalArgs and resultFingerprint", () => {
  it("sorts keys at every depth and drops undefined", () => {
    expect(canonicalArgs({ b: 1, a: { d: undefined, c: [2, 1] } })).toBe(
      canonicalArgs({ a: { c: [2, 1] }, b: 1 }),
    );
    expect(canonicalArgs({ a: { c: [2, 1] }, b: 1 })).not.toBe(
      canonicalArgs({ a: { c: [1, 2] }, b: 1 }),
    );
  });

  it("fingerprints equal results equally and holds no bytes", () => {
    expect(resultFingerprint({ a: 1, b: 2 })).toBe(resultFingerprint({ b: 2, a: 1 }));
    expect(resultFingerprint("one")).not.toBe(resultFingerprint("two"));
    expect(resultFingerprint("x".repeat(5_000_000))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("afterCall", () => {
  const call = { name: "shell", args: { command: "ls" } };

  it("warns on the third identical result and stops on the fifth", () => {
    const state = newCallGuardState();
    const results = [1, 2, 3, 4, 5].map(() => afterCall(state, call, ok(), limits));
    expect(results).toEqual([{}, {}, { note: REPEAT_NOTE }, {}, { stop: "loop" }]);
  });

  it("starts over when the result changes", () => {
    const state = newCallGuardState();
    const stops = ["a", "a", "b", "a", "a", "a", "a"].map(
      (f) => afterCall(state, call, ok(f), limits).stop,
    );
    expect(stops.every((stop) => stop === undefined)).toBe(true);
  });

  it("catches alternating calls", () => {
    const state = newCallGuardState();
    const stops: Array<string | undefined> = [];
    for (let i = 0; i < 5; i++) {
      stops.push(afterCall(state, { name: "A", args: {} }, ok(), limits).stop);
      stops.push(afterCall(state, { name: "B", args: {} }, ok(), limits).stop);
    }
    expect(stops.indexOf("loop")).toBe(8);
  });

  it("treats argument key order as the same call", () => {
    const state = newCallGuardState();
    for (let i = 0; i < 4; i++) {
      afterCall(state, { name: "t", args: i % 2 ? { a: 1, b: 2 } : { b: 2, a: 1 } }, ok(), limits);
    }
    expect(afterCall(state, { name: "t", args: { a: 1, b: 2 } }, ok(), limits)).toEqual({
      stop: "loop",
    });
  });

  it("stops after eight failures in a row, and a success resets the count", () => {
    const state = newCallGuardState();
    const failures = Array.from({ length: 8 }, (_, i) =>
      afterCall(state, { name: "t", args: { i } }, { fingerprint: `e${i}`, failed: true }, limits),
    );
    expect(failures.slice(0, 7).every((r) => r.stop === undefined)).toBe(true);
    expect(failures[7]).toEqual({ stop: "tool_errors" });

    const other = newCallGuardState();
    const run = (i: number, failed: boolean) =>
      afterCall(other, { name: "t", args: { i } }, { fingerprint: `f${i}`, failed }, limits);
    for (let i = 0; i < 7; i++) run(i, true);
    run(7, false);
    for (let i = 8; i < 15; i++) expect(run(i, true).stop).toBeUndefined();
  });

  it("calls five identical failures a loop", () => {
    const state = newCallGuardState();
    let last = {};
    for (let i = 0; i < 5; i++) {
      last = afterCall(state, call, { fingerprint: "e", failed: true }, limits);
    }
    expect(last).toEqual({ stop: "loop" });
  });

  it("keeps at most 512 keys", () => {
    const state = newCallGuardState();
    for (let i = 0; i < 600; i++) afterCall(state, { name: "t", args: { i } }, ok(), limits);
    expect(state.repeats.size).toBe(512);
  });
});

describe("beforeCall", () => {
  const counted = (name = "search") => ({ name, counted: true, idleSleepSeconds: 0 });

  it("notes the 15th call, refuses after 60 and stops on the 4th refusal", () => {
    const state = newCallGuardState();
    const results = Array.from({ length: 64 }, () => beforeCall(state, counted(), limits));
    expect(results.slice(0, 14).every((r) => r.action === "run" && !("note" in r))).toBe(true);
    expect(results[14]).toMatchObject({ action: "run", note: expect.stringContaining("search") });
    expect(results[59]).toEqual({ action: "run" });
    for (const r of results.slice(60, 63)) {
      expect(r.action).toBe("refuse");
      expect("stop" in r).toBe(false);
    }
    expect(results[63]).toMatchObject({ action: "refuse", stop: "loop" });
  });

  it("never counts uncounted calls and keeps tools apart", () => {
    const state = newCallGuardState();
    for (let i = 0; i < 200; i++) {
      expect(
        beforeCall(state, { name: "shell", counted: false, idleSleepSeconds: 0 }, limits),
      ).toEqual({ action: "run" });
    }
    for (let i = 0; i < 14; i++) beforeCall(state, counted("a"), limits);
    expect(beforeCall(state, counted("b"), limits)).toEqual({ action: "run" });
  });

  it("lets the first idle sleep run, refuses the next and stops on the fifth", () => {
    const state = newCallGuardState();
    const sleep = { name: "shell", counted: false, idleSleepSeconds: 60 };
    const results = Array.from({ length: 5 }, () => beforeCall(state, sleep, limits));
    expect(results[0]).toEqual({ action: "run" });
    for (const r of results.slice(1, 4)) {
      expect(r).toEqual({ action: "refuse", text: IDLE_SLEEP_REFUSAL });
    }
    expect(results[4]).toEqual({ action: "refuse", text: IDLE_SLEEP_REFUSAL, stop: "waiting" });
  });

  it("ignores short sleeps", () => {
    const state = newCallGuardState();
    for (let i = 0; i < 10; i++) {
      expect(
        beforeCall(state, { name: "shell", counted: false, idleSleepSeconds: 19 }, limits),
      ).toEqual({ action: "run" });
    }
  });
});
