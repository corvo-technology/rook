import type { UsageOverview } from "@corvo/contracts";
import { expect, it } from "vitest";
import {
  formatUsd,
  usageActiveAgents,
  usageBars,
  usageChange,
  usageDayLabel,
  usageFailureKinds,
  usageFold,
  usageHitRate,
  usageMetric,
  usageShare,
} from "./usage-view";

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

const spendDays: UsageOverview["days"] = [
  { date: "2026-11-01", tokens: 10, agents: { a: 10 }, spendUsd: 0, agentSpendUsd: {} },
  {
    date: "2026-11-02",
    tokens: 900,
    agents: { a: 900 },
    spendUsd: 4,
    agentSpendUsd: { a: 1, b: 3 },
  },
  { date: "2026-11-03", tokens: 50, agents: { b: 50 }, spendUsd: 2, agentSpendUsd: { b: 2 } },
];

it("draws spend per day when money was spent, with tokens only as the fallback", () => {
  const spend = { creditsUsd: 1, ownUsd: 5, ownEstimatedUsd: 5 };
  expect(usageMetric({ spend })).toBe("spend");
  expect(usageMetric({ spend: { creditsUsd: 0, ownUsd: 0, ownEstimatedUsd: 0 } })).toBe("tokens");
  expect(usageMetric({})).toBe("tokens");
  expect(usageBars(spendDays, null, "spend").map((bar) => bar.height)).toEqual([0, 1, 0.5]);
  expect(usageBars(spendDays, "a", "spend").map((bar) => bar.focus)).toEqual([0, 0.25, 0]);
});

it("compares spend with the period before when there was spend", () => {
  const spend = { creditsUsd: 3, ownUsd: 3, ownEstimatedUsd: 0 };
  expect(usageChange({ tokens: 1, previousTokens: 1, spend, previousSpendUsd: 4 })).toBe(0.5);
  expect(usageChange({ tokens: 1, previousTokens: 1, spend, previousSpendUsd: 0 })).toBeNull();
});

it("writes dollars, and never a tiny amount as zero", () => {
  expect(formatUsd(12.4, "en")).toBe("$12.40");
  expect(formatUsd(0, "en")).toBe("$0.00");
  expect(formatUsd(0.002, "en")).toBe("<$0.01");
  expect(formatUsd(7.86, "pt-BR")).toContain("7,86");
});

it("lists the agents that did something by spend and folds the rest behind a count", () => {
  const agent = (id: string, spendUsd: number, replies: number) => ({
    id,
    name: id,
    color: null,
    tokens: 1,
    replies,
    costUsd: null,
    spendUsd,
    models: [],
  });
  const active = usageActiveAgents([
    agent("idle", 0, 0),
    agent("small", 0.5, 2),
    agent("big", 9, 1),
    agent("free", 0, 3),
  ]);
  expect(active.map((item) => item.id)).toEqual(["big", "small", "free"]);
  const { shown, rest } = usageFold(active, 2);
  expect(shown.map((item) => item.id)).toEqual(["big", "small"]);
  expect(rest).toHaveLength(1);
});

it("orders failure kinds by how many runs they cost and drops empty ones", () => {
  expect(usageFailureKinds({ limit: 1, billing: 3, computer: 0 })).toEqual([
    ["billing", 3],
    ["limit", 1],
  ]);
  expect(usageFailureKinds(undefined)).toEqual([]);
});
