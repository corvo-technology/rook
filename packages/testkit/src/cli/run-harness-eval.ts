import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunModel } from "@corvo/adapter-kit";
import type { ModelTier } from "@corvo/contracts";
import { ModelConnectInputSchema } from "@corvo/contracts";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import type { EvalJudge } from "../evals/judge.js";
import { createEvalJudge } from "../evals/judge.js";
import type { EvalPricing, MeasuredCall } from "../evals/measurement.js";
import { measureCalls, SpendBudget, validatePricing } from "../evals/measurement.js";
import { redact } from "../evals/report.js";
import type { RunMode, TaskResult } from "../evals/run-harness.js";
import {
  CACHE_SIMULATION,
  PROSE_RUBRIC_VERSION,
  RUN_HARNESS_FIXTURE_VERSION,
  runTask,
  TOKEN_ESTIMATOR,
} from "../evals/run-harness.js";
import type { HarnessReport } from "../evals/run-harness-report.js";
import {
  diffAgainstBaseline,
  formatDiff,
  formatTable,
  totalsOf,
} from "../evals/run-harness-report.js";
import { HARNESS_TASKS } from "../evals/run-harness-tasks.js";
import { harnessDeps } from "./run-harness-deps.js";

type HarnessValues = {
  live?: boolean;
  list?: boolean;
  case?: string[];
  connection?: string;
  "fast-connection"?: string;
  "main-connection"?: string;
  "strong-connection"?: string;
  pricing?: string;
  "judge-connection"?: string;
  "judge-pricing"?: string;
  "spend-cap-usd"?: string;
  "timeout-ms"?: string;
  baseline?: string;
  output?: string;
};

type Connection = NonNullable<ReturnType<typeof parseConnection>>;
function parseConnection(value: unknown) {
  const parsed = ModelConnectInputSchema.safeParse(value);
  return parsed.success && parsed.data.modelId?.trim() ? parsed.data : null;
}

/**
 * Run-level harness eval. Offline (default) drives the real Pi runtime against a scripted model
 * on loopback, so every diffed number is deterministic. Live (opt-in, never in CI) runs the same
 * tasks against configured provider connections with deterministic fixture tools.
 */
export async function runRunHarnessSuite(
  values: HarnessValues,
  meta: { codeRevision: string | null; readConnection: (file: string) => unknown },
) {
  if (values.list) {
    for (const t of HARNESS_TASKS) console.log(`${t.id} [${t.tier}]: ${t.covers}`);
    return;
  }
  const selected = values.case?.length
    ? HARNESS_TASKS.filter((t) => values.case!.includes(t.id))
    : HARNESS_TASKS;
  if (!selected.length || values.case?.some((id) => !HARNESS_TASKS.some((t) => t.id === id)))
    throw new Error("Unknown harness task; use --list");
  const live = Boolean(values.live);
  const timeoutMs = Number(values["timeout-ms"]);
  if (live && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000))
    throw new Error("Timeout must be at least 1000ms");
  const baseline = values.baseline
    ? (JSON.parse(readFileSync(values.baseline, "utf8")) as HarnessReport)
    : null;
  const output = path.resolve(values.output!);
  const report: HarnessReport = {
    version: 1,
    kind: "run-harness-eval",
    mode: live ? "live" : "offline",
    fixtureVersion: RUN_HARNESS_FIXTURE_VERSION,
    rubricVersion: PROSE_RUBRIC_VERSION,
    tokenEstimator: TOKEN_ESTIMATOR,
    cacheSimulation: live ? null : CACHE_SIMULATION,
    startedAt: new Date().toISOString(),
    codeRevision: meta.codeRevision,
    subject: null,
    judgeCostUsd: null,
    subjectCostUsd: null,
    status: "stopped",
    tasks: [],
    totals: totalsOf([]),
  };
  const save = () => {
    report.totals = totalsOf(report.tasks);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(`${output}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
  };

  let mode: RunMode = { kind: "offline" };
  let judge: EvalJudge | undefined;
  const subjectCalls = new Map<string, MeasuredCall>();
  const judgeCalls = new Map<string, MeasuredCall>();
  let pricing: EvalPricing | null = null;
  let judgePricing: EvalPricing | null = null;
  const secrets: string[] = [];
  if (live) {
    loadRootEnv();
    const fail = (reason: string): never => {
      save();
      throw new Error(reason);
    };
    const base = values.connection ? parseConnection(meta.readConnection(values.connection)) : null;
    const byTier = new Map<ModelTier, Connection>();
    for (const tier of ["fast", "main", "strong"] as const) {
      const file = values[`${tier}-connection`];
      const connection = file ? parseConnection(meta.readConnection(file)) : base;
      if (file && !connection) fail(`A valid ${tier} connection is required`);
      if (connection) byTier.set(tier, connection);
    }
    if (!byTier.size)
      fail(
        "Live mode needs --connection (or per-tier --fast/--main/--strong-connection) with models/connect JSON",
      );
    for (const task of selected)
      for (const leg of task.script)
        if (!byTier.get(leg.tier ?? task.tier))
          fail(`No connection for tier ${leg.tier ?? task.tier}`);
    try {
      pricing = validatePricing(
        values.pricing ? JSON.parse(readFileSync(values.pricing, "utf8")) : null,
      );
    } catch {
      fail("Live execution requires --pricing with explicit USD per million rates");
    }
    const judgeConnection = values["judge-connection"]
      ? parseConnection(meta.readConnection(values["judge-connection"]))
      : null;
    if (values["judge-connection"]) {
      if (!judgeConnection) fail("A valid judge connection is required");
      try {
        judgePricing = validatePricing(
          values["judge-pricing"]
            ? JSON.parse(readFileSync(values["judge-pricing"], "utf8"))
            : null,
        );
      } catch {
        fail("A judge connection requires --judge-pricing with explicit USD per million rates");
      }
    }
    for (const c of [...byTier.values(), judgeConnection])
      if (c) secrets.push(c.apiKey ?? "", c.baseUrl ?? "");
    const first = [...byTier.values()][0]!;
    report.subject = { provider: first.provider, model: first.modelId! };
    const budget = new SpendBudget(Number(values["spend-cap-usd"]), pricing!);
    const { PiAgentRuntime } = await import("../../../adapters/src/pi-runtime.ts");
    const runtimeFor = (rates: EvalPricing) =>
      new PiAgentRuntime({
        modelCallObserver: {
          beforeCall: (call) =>
            budget.reserve(
              call.inputTokensEstimate,
              call.maxOutputTokens,
              call.cacheWriteRetention,
              rates,
            ),
          afterCall: (id, usage) => budget.settleUsage(id, usage),
        },
      });
    const modelOf = (c: Connection): AgentRunModel => ({
      ...c,
      id: c.modelId!,
      allowPrivateEndpoint: true,
      maxImagesPerPrompt: c.maxImagesPerPrompt ?? undefined,
      maxTokens: c.maxTokens ?? 4096,
    });
    mode = {
      kind: "live",
      runtime: runtimeFor(pricing!),
      modelFor: (tier) => modelOf(byTier.get(tier)!),
      timeoutMs,
    };
    if (judgeConnection && judgePricing) {
      const raw = createEvalJudge(runtimeFor(judgePricing), modelOf(judgeConnection), (usage) => {
        if (usage.callId) judgeCalls.set(usage.callId, { id: usage.callId, ...usage });
      });
      judge = async (input, signal) => {
        try {
          const verdict = await raw(input, signal);
          return { ...verdict, reason: redact(verdict.reason, secrets) };
        } catch (error) {
          throw new Error(
            redact(error instanceof Error ? error.message : "Judge failure", secrets),
          );
        }
      };
    }
  }

  const deps = harnessDeps();
  const results: TaskResult[] = [];
  report.tasks = results;
  save();
  for (const task of selected) {
    const { result } = await runTask(task, mode, deps, {
      judge,
      onUsage: (usage) => {
        if (usage.callId) subjectCalls.set(usage.callId, { id: usage.callId, ...usage });
      },
    });
    if (result.error) result.error = redact(result.error, secrets);
    results.push(result);
    if (pricing) report.subjectCostUsd = measureCalls([...subjectCalls.values()], pricing).costUsd;
    if (judgePricing)
      report.judgeCostUsd = measureCalls([...judgeCalls.values()], judgePricing).costUsd;
    save();
  }
  report.status = "complete";
  save();

  console.log(formatTable(report));
  if (live)
    console.log(
      `subject cost ${report.subjectCostUsd === null ? "unknown" : `$${report.subjectCostUsd.toFixed(6)}`}; judge cost ${report.judgeCostUsd === null ? "n/a" : `$${report.judgeCostUsd.toFixed(6)}`}`,
    );
  for (const task of results.filter((t) => t.status !== "pass"))
    console.log(
      `${task.id}: ${task.status}${task.error ? ` (${task.error})` : ""} ${task.checks
        .filter((c) => !c.pass)
        .map((c) => c.id)
        .join(", ")}`,
    );
  console.log(`report: ${output}`);
  if (baseline) console.log(formatDiff(diffAgainstBaseline(report, baseline)));
  if (report.totals.fail || report.totals.unqualified) process.exitCode = 1;
}
