import { describe, expect, it } from "vitest";
import {
  crossedMonthAlert,
  monthlyCeiling,
  monthlyLimitReached,
  replyCap,
  usageTokens,
  utcMonthKey,
  utcMonthStart,
} from "./bot-budget.js";

describe("monthlyCeiling", () => {
  it.each([null, undefined, 0, -5, Number.NaN])("means no ceiling for %s", (limit) => {
    expect(monthlyCeiling(limit)).toBe(Number.POSITIVE_INFINITY);
  });
  it("keeps a positive limit", () => {
    expect(monthlyCeiling(2_000_000)).toBe(2_000_000);
  });
});

describe("monthlyLimitReached", () => {
  it("never counts a missing, zero or negative limit as spent", () => {
    expect(monthlyLimitReached(10 ** 12, 0)).toBe(false);
    expect(monthlyLimitReached(10 ** 12, -1)).toBe(false);
    expect(monthlyLimitReached(10 ** 12, null)).toBe(false);
  });
  it("is reached at the limit", () => {
    expect(monthlyLimitReached(100, 100)).toBe(true);
    expect(monthlyLimitReached(99, 100)).toBe(false);
  });
});

describe("replyCap", () => {
  it("is a tenth of the limit, or of the fixed base without one", () => {
    expect(replyCap(2_000_000)).toBe(200_000);
    expect(replyCap(null)).toBe(5_000_000);
    expect(replyCap(0)).toBe(5_000_000);
  });
});

describe("crossedMonthAlert", () => {
  it("is true only when the call crosses 80% and stays under 100%", () => {
    expect(crossedMonthAlert(79, 80, 100)).toBe(true);
    expect(crossedMonthAlert(80, 90, 100)).toBe(false);
    expect(crossedMonthAlert(79, 100, 100)).toBe(false);
    expect(crossedMonthAlert(0, 10 ** 9, null)).toBe(false);
  });
});

describe("usageTokens", () => {
  it("prefers the total, then input plus output, then zero", () => {
    expect(usageTokens({ totalTokens: 100, inputTokens: 1, outputTokens: 1 })).toBe(100);
    expect(usageTokens({ totalTokens: null, inputTokens: 30, outputTokens: 20 })).toBe(50);
    expect(usageTokens({ totalTokens: null, inputTokens: null, outputTokens: null })).toBe(0);
  });
});

describe("UTC month", () => {
  const now = new Date("2026-11-30T23:59:59-03:00");
  it("starts and keys the UTC calendar month", () => {
    expect(utcMonthStart(now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(utcMonthKey(now)).toBe("2026-12");
  });
});
