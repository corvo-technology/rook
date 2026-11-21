import type { UsageOverview } from "@corvo/contracts";
import { expect, it } from "vitest";
import { usageBars, usageChange, usageDayLabel, usageHitRate, usageShare } from "./usage-view";

it("compares with the period before, and says nothing when there was none", () => {
  expect(usageChange({ tokens: 150, previousTokens: 100 })).toBe(0.5);
  expect(usageChange({ tokens: 50, previousTokens: 100 })).toBe(-0.5);
  expect(usageChange({ tokens: 50, previousTokens: 0 })).toBeNull();
});

it("keeps an agent's share between nothing and everything", () => {
  expect(usageShare(25, 100)).toBe(0.25);
  expect(usageShare(5, 0)).toBe(0);
  expect(usageShare(150, 100)).toBe(1);
});

const days: UsageOverview["days"] = [
  { date: "2026-11-01", tokens: 0, agents: {} },
  { date: "2026-11-02", tokens: 100, agents: { a: 60, b: 40 } },
  { date: "2026-11-03", tokens: 50, agents: { b: 50 } },
];

it("scales the bars to the busiest day", () => {
  expect(usageBars(days, null).map((bar) => bar.height)).toEqual([0, 1, 0.5]);
  expect(usageBars(days, null).map((bar) => bar.focus)).toEqual([0, 1, 1]);
});

it("keeps only the chosen agent in ink", () => {
  expect(usageBars(days, "a").map((bar) => bar.focus)).toEqual([0, 0.6, 0]);
  expect(usageBars(days, "b").map((bar) => bar.focus)).toEqual([0, 0.4, 1]);
});

it("is flat when nothing was used", () => {
  expect(usageBars([{ date: "2026-11-01", tokens: 0, agents: {} }], null)[0]?.height).toBe(0);
});

it("writes a day in the person's language", () => {
  expect(usageDayLabel("2026-11-03", "en")).toBe("Nov 3");
  expect(usageDayLabel("2026-11-03", "pt-BR")).toMatch(/3/);
});

it("rates the cache against all the input, and says nothing when none went in", () => {
  expect(usageHitRate({ input: 100, cacheRead: 300, cacheWrite: 100, output: 9 })).toBe(0.6);
  expect(usageHitRate({ input: 0, cacheRead: 0, cacheWrite: 0, output: 9 })).toBeNull();
});
