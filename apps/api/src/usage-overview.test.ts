import { describe, expect, it } from "vitest";
import type { UsageRow } from "./usage-overview.js";
import { buildRunOutcomes, buildUsageOverview, rowTokens, usageWindow } from "./usage-overview.js";

const NOW = new Date("2026-11-15T12:00:00Z");

const row = (over: Partial<UsageRow>): UsageRow => ({
  botId: "a",
  createdAt: new Date("2026-11-02T10:00:00Z"),
  inputTokens: 60,
  outputTokens: 40,
  totalTokens: 100,
  costUsd: 0.5,
  provider: "anthropic",
  model: "sonnet",
  runId: "r1",
  parentRunId: null,
  ...over,
});

const agents = new Map([
  ["a", { name: "Pia", color: "#10B981" }],
  ["b", { name: "Nico", color: "#3B82F6" }],
]);
const overview = (rows: UsageRow[], period: "month" | "last-month" | "30d" = "month") =>
  buildUsageOverview({ period, now: NOW, rows, agents, unknownName: "" });

describe("usageWindow", () => {
  it("compares the part of the month that has passed with the same part of the last one", () => {
    const w = usageWindow("month", NOW);
    expect(new Date(w.from).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(w.previousFrom).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(w.previousTo - w.previousFrom).toBe(w.to - w.from);
  });

  it("sets a finished month against the one before it, whole", () => {
    const w = usageWindow("last-month", NOW);
    expect(new Date(w.from).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(new Date(w.to).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(new Date(w.previousFrom).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("covers thirty whole days ending today", () => {
    const w = usageWindow("30d", NOW);
    expect(new Date(w.from).toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(w.previousFrom).toBe(w.from - 30 * 86_400_000);
  });
});

describe("rowTokens", () => {
  it("falls back to input plus output when the provider gave no total", () => {
    expect(rowTokens(row({ totalTokens: null }))).toBe(100);
    expect(rowTokens(row({ totalTokens: 7 }))).toBe(7);
  });
});

describe("buildUsageOverview", () => {
  it("keeps what was billed apart from what the cache served, per agent and in all", () => {
    const result = overview([
      row({
        botId: "a",
        inputTokens: 10,
        cacheReadTokens: 90,
        cacheWriteTokens: 5,
        outputTokens: 4,
      }),
      row({ botId: "a", inputTokens: 20, cacheReadTokens: null, outputTokens: 6 }),
      row({ botId: "b", inputTokens: 1, cacheReadTokens: 9, outputTokens: 2 }),
    ]);
    expect(result.cache).toEqual({ input: 31, cacheRead: 99, cacheWrite: 5, output: 12 });
    expect(result.agents.find((a) => a.id === "a")?.cache).toEqual({
      input: 30,
      cacheRead: 90,
      cacheWrite: 5,
      output: 10,
    });
  });

  it("totals the period, splits it by agent and counts replies once per run", () => {
    const result = overview([
      row({ botId: "a", runId: "r1" }),
      row({ botId: "a", runId: "r1" }),
      row({ botId: "a", runId: "child", parentRunId: "r1" }),
      row({ botId: "b", runId: "r2", totalTokens: 50 }),
    ]);
    expect(result.tokens).toBe(350);
    expect(result.replies).toBe(2);
    expect(result.agents.map((a) => [a.name, a.tokens, a.replies])).toEqual([
      ["Pia", 300, 1],
      ["Nico", 50, 1],
    ]);
  });

  it("compares with the same point of the previous period and leaves older rows out", () => {
    const result = overview([
      row({ createdAt: new Date("2026-11-03T00:00:00Z") }),
      row({ createdAt: new Date("2026-10-03T00:00:00Z"), totalTokens: 40 }),
      row({ createdAt: new Date("2026-10-28T00:00:00Z"), totalTokens: 999 }),
    ]);
    expect(result.tokens).toBe(100);
    expect(result.previousTokens).toBe(40);
  });

  it("gives every day of the period a place, with the agents that used it", () => {
    const result = overview([
      row({ createdAt: new Date("2026-11-02T08:00:00Z"), botId: "a" }),
      row({ createdAt: new Date("2026-11-02T09:00:00Z"), botId: "b", totalTokens: 10 }),
    ]);
    // November has 30 days; the ones still to come are there, empty.
    expect(result.days).toHaveLength(30);
    expect(result.days[0]?.date).toBe("2026-11-01");
    expect(result.days[0]?.tokens).toBe(0);
    expect(result.days[1]).toEqual({ date: "2026-11-02", tokens: 110, agents: { a: 100, b: 10 } });
  });

  it("reports cost as unknown when any call lacks it, and keeps the agent's models", () => {
    const result = overview([
      row({ costUsd: 1 }),
      row({ costUsd: null, model: "opus", totalTokens: 300 }),
    ]);
    expect(result.costUsd).toBeNull();
    expect(result.agents[0]?.costUsd).toBeNull();
    expect(result.agents[0]?.models.map((m) => m.model)).toEqual(["opus", "sonnet"]);
  });

  it("keeps spend whose agent is gone, without a name for the page to word", () => {
    const result = overview([row({ botId: "gone" }), row({ botId: null })]);
    expect(result.agents.map((a) => [a.id, a.name])).toEqual([
      ["gone", ""],
      [null, ""],
    ]);
  });

  it("is empty and finite when nothing was used", () => {
    const result = overview([]);
    expect(result.tokens).toBe(0);
    expect(result.agents).toEqual([]);
    expect(result.costUsd).toBe(0);
  });
});

describe("run outcomes", () => {
  const at = (iso: string) => new Date(`2026-11-02T${iso}Z`);
  const run = (status: string, started?: string, done?: string, botId = "a") => ({
    botId,
    status,
    startedAt: started ? at(started) : null,
    completedAt: done ? at(done) : null,
  });

  it("counts failed runs per agent and averages how long finished ones took", () => {
    const outcomes = buildRunOutcomes([
      run("completed", "10:00:00", "10:00:10"),
      run("completed", "11:00:00", "11:00:30"),
      run("failed", "12:00:00", "12:00:05"),
      run("cancelled"),
      run("completed", "09:00:00", "09:01:00", "b"),
    ]);
    expect(outcomes.get("a")).toEqual({ failed: 1, avgSeconds: 20, topError: null });
    expect(outcomes.get("b")).toEqual({ failed: 0, avgSeconds: 60, topError: null });
  });

  it("has no average when no finished run has both times", () => {
    expect(buildRunOutcomes([run("failed")]).get("a")).toEqual({
      failed: 1,
      avgSeconds: null,
      topError: null,
    });
  });

  it("puts the outcomes on the agents that have usage and leaves others without", () => {
    const outcomes = buildRunOutcomes([run("failed", "10:00:00", "10:00:05")]);
    const result = buildUsageOverview({
      period: "month",
      now: NOW,
      rows: [row({ botId: "a" }), row({ botId: "b", runId: "r2" })],
      agents,
      unknownName: "",
      outcomes,
    });
    expect(result.agents.find((agent) => agent.id === "a")?.failed).toBe(1);
    expect(result.agents.find((agent) => agent.id === "b")?.failed).toBeUndefined();
  });
});

describe("buildRunOutcomes top error", () => {
  const run = (error: string | null, status = "failed") => ({
    botId: "a",
    status,
    startedAt: null,
    completedAt: null,
    error,
  });
  const limit = (id: string) => `429 {"error":{"message":"rate limit ${id}"}}`;

  it("keeps the error of the most common kind of failure, however its words differ", () => {
    const outcomes = buildRunOutcomes([
      run("The model hit its output limit before writing a response."),
      run(limit("one")),
      run(limit("two")),
    ]);
    expect(outcomes.get("a")?.failed).toBe(3);
    expect(outcomes.get("a")?.topError).toContain("rate limit");
  });

  it("has none when no failed run left an error, and ignores the errors of runs that did not fail", () => {
    expect(buildRunOutcomes([run(null), run("   ")]).get("a")?.topError).toBeNull();
    expect(buildRunOutcomes([run(limit("x"), "completed")]).get("a")?.topError).toBeNull();
  });
});

describe("spend by model tier", () => {
  it("sums each tier's tokens and cost, cheapest first, and carries the escalation count", () => {
    const result = buildUsageOverview({
      period: "month",
      now: NOW,
      agents,
      unknownName: "",
      escalations: 2,
      requestedEscalations: 1,
      rows: [
        row({ modelTier: "strong", costUsd: 0.4 }),
        row({ modelTier: "fast", costUsd: 0.01, runId: "r2" }),
        row({ modelTier: "fast", costUsd: 0.02, runId: "r3" }),
        row({ modelTier: null, runId: "r4" }),
      ],
    });
    expect(result.tiers).toEqual([
      { tier: "fast", tokens: 200, costUsd: expect.closeTo(0.03) },
      { tier: "strong", tokens: 100, costUsd: 0.4 },
    ]);
    expect(result.escalations).toBe(2);
    expect(result.requestedEscalations).toBe(1);
  });

  it("has no tiers when no agent picked its model, and does not invent a cost", () => {
    expect(overview([row({})]).tiers).toEqual([]);
    expect(overview([row({})]).escalations).toBe(0);
    const unknownCost = buildUsageOverview({
      period: "month",
      now: NOW,
      agents,
      unknownName: "",
      rows: [row({ modelTier: "main", costUsd: null })],
    });
    expect(unknownCost.tiers).toEqual([{ tier: "main", tokens: 100, costUsd: null }]);
  });
});
