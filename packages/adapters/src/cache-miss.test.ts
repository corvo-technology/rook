import { describe, expect, it } from "vitest";
import { CacheMissTracker } from "./cache-miss.js";

const MINUTE = 60_000;
const miss = { inputTokens: 8_000, cacheReadTokens: 0, cacheWriteTokens: 8_000 };
const hit = { inputTokens: 8_000, cacheReadTokens: 7_500, cacheWriteTokens: 0 };

describe("CacheMissTracker", () => {
  it("names the first call and counts a later hit", () => {
    const tracker = new CacheMissTracker();
    expect(tracker.observe(miss, "a/model", 0)).toBe("first_call");
    expect(tracker.observe(hit, "a/model", MINUTE)).toBeUndefined();
    expect(tracker.counters).toEqual({ calls: 2, hits: 1, misses: 1, byReason: { first_call: 1 } });
  });

  it("blames a model change, an expired cache, and a prompt too short to cache", () => {
    const tracker = new CacheMissTracker();
    tracker.observe(hit, "a/model", 0);
    expect(tracker.observe(miss, "b/backup", MINUTE)).toBe("model_changed");
    expect(tracker.observe(miss, "b/backup", 10 * MINUTE)).toBe("expired");
    expect(tracker.observe({ ...miss, inputTokens: 300 }, "b/backup", 10 * MINUTE + 1_000)).toBe(
      "below_minimum",
    );
    expect(tracker.observe(miss, "b/backup", 10 * MINUTE + 2_000)).toBe("unexplained");
  });

  it("allows an hour after a long-retention write", () => {
    const tracker = new CacheMissTracker();
    tracker.observe({ ...miss, cacheWrite1hTokens: 8_000 }, "a/model", 0);
    expect(tracker.observe(miss, "a/model", 30 * MINUTE)).toBe("unexplained");
  });

  it("does not judge a provider that reports no cache measurement", () => {
    const tracker = new CacheMissTracker();
    expect(tracker.observe({ inputTokens: 9_000 }, "a/model", 0)).toBeUndefined();
    expect(tracker.counters.calls).toBe(0);
  });
});
