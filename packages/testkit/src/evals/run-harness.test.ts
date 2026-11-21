import { describe, expect, it } from "vitest";
import { harnessDeps } from "../cli/run-harness-deps.js";
import {
  CACHE_SIMULATION,
  PROSE_JUDGE_CALIBRATION,
  PROSE_RUBRIC_VERSION,
  RUN_HARNESS_FIXTURE_VERSION,
  runTask,
  TOKEN_ESTIMATOR,
} from "./run-harness.js";
import type { HarnessReport } from "./run-harness-report.js";
import { diffAgainstBaseline, formatDiff, formatTable, totalsOf } from "./run-harness-report.js";
import { HARNESS_TASKS } from "./run-harness-tasks.js";

const deps = harnessDeps();

async function offlineReport(): Promise<HarnessReport> {
  const tasks = [];
  for (const task of HARNESS_TASKS)
    tasks.push((await runTask(task, { kind: "offline" }, deps)).result);
  return {
    version: 1,
    kind: "run-harness-eval",
    mode: "offline",
    fixtureVersion: RUN_HARNESS_FIXTURE_VERSION,
    rubricVersion: PROSE_RUBRIC_VERSION,
    tokenEstimator: TOKEN_ESTIMATOR,
    cacheSimulation: CACHE_SIMULATION,
    startedAt: "2000-01-01T00:00:00.000Z",
    codeRevision: null,
    subject: null,
    judgeCostUsd: null,
    subjectCostUsd: null,
    status: "complete",
    tasks,
    totals: totalsOf(tasks),
  };
}

describe("run-level harness eval, offline", () => {
  it("has about twenty uniquely named tasks", () => {
    expect(HARNESS_TASKS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(HARNESS_TASKS.map((t) => t.id)).size).toBe(HARNESS_TASKS.length);
  });

  it("passes every task and accounts tokens consistently", async () => {
    const report = await offlineReport();
    for (const task of report.tasks) {
      expect(task.error, task.id).toBeNull();
      expect(
        task.checks.filter((c) => !c.pass).map((c) => c.id),
        task.id,
      ).toEqual([]);
      expect(task.status, task.id).toBe("pass");
      const m = task.metrics;
      expect(m.modelCalls, task.id).toBeGreaterThan(0);
      expect(m.schemaTokensPerCall, task.id).toBeGreaterThan(0);
      expect(m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens, task.id).toBeGreaterThan(0);
    }
    const byId = new Map(report.tasks.map((t) => [t.id, t]));
    // Cache reuse shows up only when a run makes more than one model call.
    expect(byId.get("quick-question")!.metrics.cacheReadTokens).toBe(0);
    expect(byId.get("web-lookup")!.metrics.cacheReadTokens).toBeGreaterThan(0);
    // The escalation ran on two tiers and the approval gate on one call.
    expect(byId.get("needs-stronger-model")!.tiers).toEqual(["main", "strong"]);
    expect(byId.get("approval-gated-send")!.metrics.modelCalls).toBe(1);
    // Every prompt token is accounted once, and the tool schemas are part of the first call.
    const quick = byId.get("quick-question")!.metrics;
    expect(quick.inputTokens + quick.cacheWriteTokens).toBeGreaterThan(quick.schemaTokensFirstCall);
    // A greeting offers the same tools as a question: the schema cost is a harness constant.
    expect(byId.get("greeting")!.metrics.schemaTokensFirstCall).toBe(
      byId.get("quick-question")!.metrics.schemaTokensFirstCall,
    );
  });

  it("is deterministic in every diffed metric", async () => {
    const a = await offlineReport();
    const b = await offlineReport();
    expect(diffAgainstBaseline(b, a).deltas).toEqual([]);
  });

  it("flags a regression against a baseline and prints a table", async () => {
    const report = await offlineReport();
    const baseline = structuredClone(report);
    baseline.tasks[0]!.metrics.inputTokens -= 10;
    baseline.tasks.pop();
    const diff = diffAgainstBaseline(report, baseline);
    expect(diff.deltas).toContainEqual(
      expect.objectContaining({ task: report.tasks[0]!.id, metric: "inputTokens" }),
    );
    expect(diff.added).toEqual([report.tasks.at(-1)!.id]);
    expect(formatDiff(diff)).toContain("Against baseline");
    expect(formatTable(report)).toContain("schema/call");
    expect(() => diffAgainstBaseline(report, { ...baseline, mode: "live" })).toThrow(/live mode/);
  });

  it("grades prose only through an opt-in judge, and a judge error is unqualified", async () => {
    const task = HARNESS_TASKS.find((t) => t.id === "greeting")!;
    expect((await runTask(task, { kind: "offline" }, deps)).result.prose?.status).toBe("skipped");
    const judged = await runTask(task, { kind: "offline" }, deps, {
      judge: async () => ({ pass: true, reason: "ok" }),
    });
    expect(judged.result.prose?.status).toBe("pass");
    const rejected = await runTask(task, { kind: "offline" }, deps, {
      judge: async () => ({ pass: false, reason: "no" }),
    });
    expect(rejected.result.status).toBe("fail");
    const broken = await runTask(task, { kind: "offline" }, deps, {
      judge: async () => {
        throw new Error("provider down");
      },
    });
    expect(broken.result.status).toBe("unqualified");
  });

  it("keeps calibration examples for every prose criterion", () => {
    expect(PROSE_JUDGE_CALIBRATION.some((e) => e.pass)).toBe(true);
    expect(PROSE_JUDGE_CALIBRATION.some((e) => !e.pass)).toBe(true);
    for (const task of HARNESS_TASKS.filter((t) => t.prose))
      expect(task.prose!.criterion.length).toBeGreaterThan(10);
  });
});
