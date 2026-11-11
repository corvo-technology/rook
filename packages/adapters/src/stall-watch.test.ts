import { describe, expect, it } from "vitest";
import { newStallWatch, stallBegin, stallEnd, stallSign, stallTick } from "./stall-watch.js";

const limits = { stallMs: 1_200_000, stallTickMs: 15_000 };
const TICK = 15_000;

/** Ticks every 15 s from `from` (exclusive) through `to`, returning the first stalled time. */
function firstStall(watch: ReturnType<typeof newStallWatch>, from: number, to: number) {
  for (let t = from + TICK; t <= to; t += TICK) {
    if (stallTick(watch, t, limits)) return t;
  }
  return undefined;
}

describe("stallTick", () => {
  it("reports silence only after the limit", () => {
    const watch = newStallWatch(0);
    expect(firstStall(watch, 0, 1_200_000)).toBeUndefined();
    expect(stallTick(watch, 1_215_000, limits)).toBe(true);
  });

  it("restarts the clock on a sign of life", () => {
    const watch = newStallWatch(0);
    expect(firstStall(watch, 0, 600_000)).toBeUndefined();
    stallSign(watch, 600_000);
    expect(firstStall(watch, 600_000, 1_215_000)).toBeUndefined();
    expect(firstStall(watch, 1_215_000, 1_815_000)).toBe(1_815_000);
  });

  it("never stalls while something is in flight", () => {
    const watch = newStallWatch(0);
    stallBegin(watch, 0);
    expect(firstStall(watch, 0, 3_600_000)).toBeUndefined();
    stallEnd(watch, 3_600_000);
    // 20 minutes and one tick of silence is 81 ticks; the 81st reports the stall.
    const ticks = Array.from({ length: 81 }, (_, i) =>
      stallTick(watch, 3_600_000 + (i + 1) * TICK, limits),
    );
    expect(ticks.indexOf(true)).toBe(80);
  });

  it("does not count a suspended machine", () => {
    const watch = newStallWatch(0);
    expect(firstStall(watch, 0, 300_000)).toBeUndefined();
    expect(stallTick(watch, 4_000_000, limits)).toBe(false);
    expect(watch.lastSignAt).toBe(4_000_000);
    expect(firstStall(watch, 4_000_000, 5_200_000)).toBeUndefined();
    expect(stallTick(watch, 5_215_000, limits)).toBe(true);
  });

  it("does not reset on a late tick that is not a suspension", () => {
    const watch = newStallWatch(0);
    stallTick(watch, 15_000, limits);
    stallTick(watch, 95_000, limits);
    expect(watch.lastSignAt).toBe(0);
  });

  it("survives a clock that moved back", () => {
    const watch = newStallWatch(5_000);
    expect(stallTick(watch, 1_000, limits)).toBe(false);
    expect(watch.lastSignAt).toBe(1_000);
  });

  it("keeps inFlight at zero when ended twice", () => {
    const watch = newStallWatch(0);
    stallBegin(watch, 1);
    stallEnd(watch, 2);
    stallEnd(watch, 3);
    expect(watch.inFlight).toBe(0);
  });
});
