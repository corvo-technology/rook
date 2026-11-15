import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunRequest } from "@corvo/adapter-kit";
import type { ModelTier } from "@corvo/contracts";
import { ModelConnectInputSchema } from "@corvo/contracts";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import type { EvalJudge } from "../evals/judge.js";
import { createEvalJudge } from "../evals/judge.js";
import type { EvalPricing, MeasuredCall } from "../evals/measurement.js";
import { measureCalls, SpendBudget, validatePricing } from "../evals/measurement.js";
import type { RoutingGrade } from "../evals/model-routing.js";
import {
  gradeRouting,
  MODEL_ROUTING_CASES,
  MODEL_ROUTING_RUBRIC_VERSION,
} from "../evals/model-routing.js";
import { redact } from "../evals/report.js";

type ModelRoutingEvalValues = {
  live?: boolean;
  list?: boolean;
  case?: string[];
  trials?: string;
  /** The fixed strong model, which is also the strong tier of Automatic. */
  connection?: string;
  pricing?: string;
  "fast-connection"?: string;
  "fast-pricing"?: string;
  "main-connection"?: string;
  "main-pricing"?: string;
  "judge-connection"?: string;
  "judge-pricing"?: string;
  "spend-cap-usd"?: string;
  "timeout-ms"?: string;
  output?: string;
};

type Arm = {
  connection: NonNullable<ReturnType<typeof ModelConnectInputSchema.parse>>;
  rates: EvalPricing;
};

/**
 * Compares Automatic with a fixed strong model on a small fixed task set. Automatic picks each
 * task's tier with the product's own deterministic router, then answers on that tier's model. A
 * judge, opt-in and graded by a versioned rubric, decides whether Automatic's answer is at least
 * as good as the strong model's. Automatic's, the strong arm's and the judge's costs are reported
 * apart, and a judge that errors leaves a task unqualified rather than passed. Never run in CI.
 */
export async function runModelRoutingSuite(
  values: ModelRoutingEvalValues,
  meta: {
    codeRevision: string | null;
    workingDiffHash: string | null;
    readConnection: (file: string) => unknown;
  },
) {
  if (values.list) {
    for (const c of MODEL_ROUTING_CASES) console.log(`${c.id}: expected tier ${c.expectedTier}`);
    return;
  }
  const selected = values.case?.length
    ? MODEL_ROUTING_CASES.filter((c) => values.case!.includes(c.id))
    : MODEL_ROUTING_CASES;
  if (!selected.length || values.case?.some((id) => !MODEL_ROUTING_CASES.some((c) => c.id === id)))
    throw new Error("Unknown eval case; use --list");
  const trials = Number(values.trials);
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 10)
    throw new Error("Trials must be an integer from 1 to 10");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000)
    throw new Error("Timeout must be at least 1000ms");
  const output = path.resolve(values.output!);
  type Result = {
    caseId: string;
    trial: number;
    tier: ModelTier | null;
    status: RoutingGrade["status"] | "not-run";
    reason: string | null;
  };
  const results: Result[] = [];
  const report = {
    version: 1,
    kind: "model-routing-eval",
    startedAt: new Date().toISOString(),
    rubricVersion: MODEL_ROUTING_RUBRIC_VERSION,
    codeRevision: meta.codeRevision,
    workingDiffHash: meta.workingDiffHash,
    controls: { trials, timeoutMs },
    arms: null as null | Record<string, { provider: string; model: string }>,
    judge: null as null | { provider: string; model: string },
    spendCapUsd: Number(values["spend-cap-usd"]),
    status: "not-run" as "not-run" | "complete",
    reason: null as string | null,
    autoCostUsd: null as number | null,
    strongCostUsd: null as number | null,
    judgeCostUsd: null as number | null,
    costSource:
      "Automatic, the fixed strong model and the judge are measured separately, from the provider's reported charge when available, otherwise from explicit pricing; unknown stays null.",
    scoring:
      "A task passes when the judge finds Automatic's answer at least as good as the strong model's. No judge, or a judge that errors, is unqualified, never a pass.",
    cases: selected.map((c) => c.id),
    results,
    summary: { pass: 0, fail: 0, unqualified: 0, notRun: 0 },
  };
  const save = () => {
    report.summary = {
      pass: results.filter((r) => r.status === "pass").length,
      fail: results.filter((r) => r.status === "fail").length,
      unqualified: results.filter((r) => r.status === "unqualified").length,
      notRun: results.filter((r) => r.status === "not-run").length,
    };
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(`${output}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
  };
  const notRun = (reason: string): never => {
    report.reason = reason;
    save();
    throw new Error(reason);
  };
  for (const c of selected)
    for (let trial = 1; trial <= trials; trial += 1)
      results.push({ caseId: c.id, trial, tier: null, status: "not-run", reason: null });
  save();
  if (!values.live) notRun("Live execution requires --live; no case was run");
  loadRootEnv();

  const parse = (file: string | undefined) => {
    if (!file) return null;
    const parsed = ModelConnectInputSchema.safeParse(meta.readConnection(file));
    return parsed.success && parsed.data.modelId?.trim() ? parsed.data : null;
  };
  const rates = (file: string | undefined, label: string): EvalPricing => {
    try {
      return validatePricing(file ? JSON.parse(readFileSync(file, "utf8")) : null);
    } catch {
      return notRun(`${label} needs explicit USD per million rates`);
    }
  };
  const strongConnection = parse(values.connection);
  if (!strongConnection)
    return notRun("A valid strong connection is required: --connection with models/connect JSON");
  const strong: Arm = { connection: strongConnection, rates: rates(values.pricing, "--pricing") };
  const tierArm = (file: string | undefined, pricing: string | undefined, label: string): Arm => {
    if (!file) return strong;
    const connection = parse(file);
    if (!connection) return notRun(`A valid ${label} connection is required`);
    return { connection, rates: rates(pricing, `--${label}-pricing`) };
  };
  const arms: Record<ModelTier, Arm> = {
    fast: tierArm(values["fast-connection"], values["fast-pricing"], "fast"),
    main: tierArm(values["main-connection"], values["main-pricing"], "main"),
    strong,
  };
  const judgeConnection = values["judge-connection"] ? parse(values["judge-connection"]) : null;
  if (values["judge-connection"] && !judgeConnection)
    return notRun("A valid judge connection is required");
  const judgePricing = judgeConnection
    ? rates(values["judge-pricing"], "A judge connection (--judge-pricing)")
    : null;
  report.arms = Object.fromEntries(
    (Object.keys(arms) as ModelTier[]).map((tier) => [
      tier,
      { provider: arms[tier].connection.provider, model: arms[tier].connection.modelId! },
    ]),
  );
  if (judgeConnection)
    report.judge = { provider: judgeConnection.provider, model: judgeConnection.modelId! };

  const { decideTier } = await import("@corvo/adapters");
  const budget = new SpendBudget(report.spendCapUsd, strong.rates);
  const autoCalls = new Map<string, MeasuredCall>();
  const strongCalls = new Map<string, MeasuredCall>();
  const judgeCalls = new Map<string, MeasuredCall>();
  const { PiAgentRuntime } = await import("../../../adapters/src/pi-runtime.ts");
  const runtimeFor = (who: { provider: string; modelId?: string | null }, priced: EvalPricing) =>
    new PiAgentRuntime({
      modelCallObserver: {
        beforeCall: (call) => {
          if (call.provider !== who.provider || call.modelId !== who.modelId)
            throw new Error("Eval model has no configured pricing");
          return budget.reserve(
            call.inputTokensEstimate,
            call.maxOutputTokens,
            call.cacheWriteRetention,
            priced,
          );
        },
        afterCall: (id, usage) => budget.settleUsage(id, usage),
      },
    });
  const modelOf = (c: Arm["connection"]) => ({
    ...c,
    id: c.modelId!,
    allowPrivateEndpoint: true,
    maxImagesPerPrompt: c.maxImagesPerPrompt ?? undefined,
    maxTokens: c.maxTokens ?? 2048,
  });
  const collect =
    (into: Map<string, MeasuredCall>): NonNullable<AgentRunRequest["onUsage"]> =>
    (usage) => {
      if (usage.callId) into.set(usage.callId, { id: usage.callId, ...usage });
    };
  const answer = async (arm: Arm, prompt: string, into: Map<string, MeasuredCall>) => {
    const runtime = runtimeFor(arm.connection, arm.rates);
    const id = randomUUID();
    let text = "";
    try {
      for await (const event of runtime.run(
        {
          botId: id,
          threadId: id,
          runId: id,
          instructions: "Answer the request directly and concisely.",
          prompt,
          history: [],
          tools: [],
          model: modelOf(arm.connection),
          allowSilentEmpty: true,
          onUsage: collect(into),
        },
        {
          operationId: id,
          traceId: id,
          spaceId: id,
          userId: id,
          signal: AbortSignal.timeout(timeoutMs),
        },
      )) {
        if (event.type === "done" && event.text) text = event.text.trim();
      }
    } finally {
      await runtime.abort(id);
    }
    return text;
  };
  let judge: EvalJudge | undefined;
  if (judgeConnection && judgePricing) {
    const secrets = [judgeConnection.apiKey ?? "", judgeConnection.baseUrl ?? ""];
    const raw = createEvalJudge(
      runtimeFor(judgeConnection, judgePricing),
      modelOf(judgeConnection),
      collect(judgeCalls),
    );
    judge = async (input, signal) => {
      try {
        const verdict = await raw(input, signal);
        return { ...verdict, reason: redact(verdict.reason, secrets) };
      } catch (error) {
        throw new Error(redact(error instanceof Error ? error.message : "Judge failure", secrets));
      }
    };
  }

  const secrets = [
    ...Object.values(arms).flatMap((arm) => [
      arm.connection.apiKey ?? "",
      arm.connection.baseUrl ?? "",
    ]),
  ];
  for (const result of results) {
    const testCase = selected.find((c) => c.id === result.caseId)!;
    const tier = decideTier({
      title: testCase.title,
      description: testCase.description,
      trigger: "user",
      prompt: testCase.prompt,
      contextTokens: 200,
      attachments: 0,
      approvalGated: testCase.id === "approved-send",
    }).tier;
    result.tier = tier;
    let grade: RoutingGrade;
    try {
      const [auto, fixed] = await Promise.all([
        answer(arms[tier], testCase.prompt, autoCalls),
        answer(strong, testCase.prompt, strongCalls),
      ]);
      grade = await gradeRouting(
        testCase,
        { auto, strong: fixed },
        result.trial % 2 === 1,
        judge ? { judge, signal: AbortSignal.timeout(timeoutMs) } : undefined,
      );
    } catch (error) {
      grade = {
        status: "unqualified",
        reason: redact(error instanceof Error ? error.message : "The model call failed", secrets),
      };
    }
    result.status = grade.status;
    result.reason = grade.reason;
    report.autoCostUsd = measureCalls([...autoCalls.values()], strong.rates).costUsd;
    report.strongCostUsd = measureCalls([...strongCalls.values()], strong.rates).costUsd;
    report.judgeCostUsd = judgePricing
      ? measureCalls([...judgeCalls.values()], judgePricing).costUsd
      : null;
    save();
    console.log(`${result.caseId} trial ${result.trial}: tier ${tier}, ${grade.status}`);
  }
  report.status = "complete";
  save();
  const s = report.summary;
  const money = (value: number | null) => (value === null ? "unknown" : `$${value.toFixed(6)}`);
  console.log(
    `pass ${s.pass}; fail ${s.fail}; unqualified ${s.unqualified}; automatic ${money(report.autoCostUsd)}; fixed strong ${money(report.strongCostUsd)}; judge ${money(report.judgeCostUsd)}`,
  );
  if (s.fail || s.unqualified) process.exitCode = 1;
}
