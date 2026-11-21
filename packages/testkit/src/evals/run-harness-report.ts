import type { TaskMetrics, TaskResult } from "./run-harness.js";

export type HarnessReport = {
  version: 1;
  kind: "run-harness-eval";
  mode: "offline" | "live";
  fixtureVersion: string;
  rubricVersion: string;
  tokenEstimator: string;
  cacheSimulation: string | null;
  startedAt: string;
  codeRevision: string | null;
  subject: null | { provider: string; model: string };
  /** Judge calls are reported apart from the run's own usage. */
  judgeCostUsd: number | null;
  subjectCostUsd: number | null;
  status: "complete" | "stopped";
  tasks: TaskResult[];
  totals: Totals;
};

export type Totals = TaskMetrics & {
  pass: number;
  fail: number;
  unqualified: number;
  tasks: number;
};

const SUMMED = [
  "inputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "outputTokens",
  "modelCalls",
  "toolCalls",
  "wallMs",
] as const;

export function totalsOf(tasks: TaskResult[]): Totals {
  const total = (key: (typeof SUMMED)[number]) => tasks.reduce((a, t) => a + t.metrics[key], 0);
  const withCalls = tasks.filter((t) => t.metrics.modelCalls > 0);
  const calls = withCalls.reduce((a, t) => a + t.metrics.modelCalls, 0);
  return {
    tasks: tasks.length,
    pass: tasks.filter((t) => t.status === "pass").length,
    fail: tasks.filter((t) => t.status === "fail").length,
    unqualified: tasks.filter((t) => t.status === "unqualified").length,
    inputTokens: total("inputTokens"),
    cacheReadTokens: total("cacheReadTokens"),
    cacheWriteTokens: total("cacheWriteTokens"),
    outputTokens: total("outputTokens"),
    modelCalls: total("modelCalls"),
    toolCalls: total("toolCalls"),
    wallMs: total("wallMs"),
    // Weighted by model calls, so it answers "what does the average call carry".
    schemaTokensPerCall: calls
      ? Math.round(
          withCalls.reduce((a, t) => a + t.metrics.schemaTokensPerCall * t.metrics.modelCalls, 0) /
            calls,
        )
      : 0,
    schemaTokensFirstCall: calls
      ? Math.round(
          withCalls.reduce((a, t) => a + t.metrics.schemaTokensFirstCall, 0) / withCalls.length,
        )
      : 0,
    firstVisibleTextMs: null,
  };
}

const pad = (value: string, width: number, right = false) =>
  right ? value.padStart(width) : value.padEnd(width);
const num = (value: number | null) => (value === null ? "-" : String(value));

export function formatTable(report: HarnessReport): string {
  const header = [
    ["task", 24],
    ["tier", 12],
    ["result", 6],
    ["calls", 5, true],
    ["tools", 5, true],
    ["input", 7, true],
    ["cacheR", 7, true],
    ["cacheW", 7, true],
    ["output", 6, true],
    ["schema/call", 11, true],
    ["wall ms", 7, true],
    ["first text ms", 13, true],
  ] as const;
  const line = (cells: string[]) =>
    header.map(([, width, right], i) => pad(cells[i]!, width, right)).join("  ");
  const rows = report.tasks.map((t) =>
    line([
      t.id,
      t.tiers.join(">"),
      t.status === "pass" ? "pass" : t.status === "fail" ? "FAIL" : "UNQUAL",
      String(t.metrics.modelCalls),
      String(t.metrics.toolCalls),
      String(t.metrics.inputTokens),
      String(t.metrics.cacheReadTokens),
      String(t.metrics.cacheWriteTokens),
      String(t.metrics.outputTokens),
      String(t.metrics.schemaTokensPerCall),
      String(t.metrics.wallMs),
      num(t.metrics.firstVisibleTextMs),
    ]),
  );
  const t = report.totals;
  const totalRow = line([
    `total (${t.pass}/${t.tasks} pass)`,
    "",
    "",
    String(t.modelCalls),
    String(t.toolCalls),
    String(t.inputTokens),
    String(t.cacheReadTokens),
    String(t.cacheWriteTokens),
    String(t.outputTokens),
    String(t.schemaTokensPerCall),
    String(t.wallMs),
    "",
  ]);
  const title = line(header.map(([name]) => name));
  return [title, "-".repeat(title.length), ...rows, "-".repeat(title.length), totalRow].join("\n");
}

/** Metrics that are exact in offline mode. Wall time and first-text latency are noise, not diffs. */
const DIFFED = [
  "inputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "outputTokens",
  "modelCalls",
  "toolCalls",
  "schemaTokensPerCall",
] as const satisfies ReadonlyArray<keyof TaskMetrics>;

export type Delta = { task: string; metric: string; before: number; after: number };

export function diffAgainstBaseline(report: HarnessReport, baseline: HarnessReport) {
  if (baseline.kind !== "run-harness-eval" || baseline.version !== 1)
    throw new Error("The baseline is not a run-harness report");
  if (baseline.mode !== report.mode)
    throw new Error(`The baseline was taken in ${baseline.mode} mode; this run is ${report.mode}`);
  const before = new Map(baseline.tasks.map((t) => [t.id, t]));
  const deltas: Delta[] = [];
  const missing: string[] = [];
  for (const task of report.tasks) {
    const old = before.get(task.id);
    if (!old) {
      missing.push(task.id);
      continue;
    }
    for (const metric of DIFFED) {
      if (old.metrics[metric] !== task.metrics[metric])
        deltas.push({
          task: task.id,
          metric,
          before: old.metrics[metric],
          after: task.metrics[metric],
        });
    }
    if (old.status !== task.status)
      deltas.push({ task: task.id, metric: `status ${old.status}`, before: 0, after: 0 });
  }
  const removed = baseline.tasks
    .filter((t) => !report.tasks.some((r) => r.id === t.id))
    .map((t) => t.id);
  const totalsDelta = DIFFED.map((metric) => ({
    metric,
    before: baseline.totals[metric],
    after: report.totals[metric],
  }));
  return {
    deltas,
    added: missing,
    removed,
    totals: totalsDelta,
    fixtureChanged: baseline.fixtureVersion !== report.fixtureVersion,
  };
}

export function formatDiff(diff: ReturnType<typeof diffAgainstBaseline>): string {
  const pct = (a: number, b: number) =>
    a === 0 ? (b === 0 ? "0%" : "new") : `${(((b - a) / a) * 100).toFixed(1)}%`;
  const lines = ["Against baseline:"];
  if (diff.fixtureChanged)
    lines.push("  The fixture version changed; deltas mix harness and task changes.");
  for (const t of diff.totals)
    lines.push(`  total ${t.metric}: ${t.before} -> ${t.after} (${pct(t.before, t.after)})`);
  if (diff.added.length) lines.push(`  new tasks: ${diff.added.join(", ")}`);
  if (diff.removed.length) lines.push(`  removed tasks: ${diff.removed.join(", ")}`);
  for (const d of diff.deltas)
    lines.push(`  ${d.task} ${d.metric}: ${d.before} -> ${d.after} (${pct(d.before, d.after)})`);
  if (!diff.deltas.length && !diff.added.length && !diff.removed.length)
    lines.push("  no per-task changes");
  return lines.join("\n");
}
