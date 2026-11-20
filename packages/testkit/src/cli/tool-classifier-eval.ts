import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ModelCallObserver } from "@corvo/adapter-kit";
import { ModelConnectInputSchema } from "@corvo/contracts";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import type { EvalPricing, MeasuredCall } from "../evals/measurement.js";
import { SpendBudget, validatePricing } from "../evals/measurement.js";
import { redact } from "../evals/report.js";
import type { ToolClassifierCaseResult } from "../evals/tool-classifier.js";
import {
  runToolClassifierCases,
  summarizeToolClassifier,
  TOOL_CLASSIFIER_EXAMPLES,
  TOOL_CLASSIFIER_EXAMPLES_VERSION,
  TOOL_CLASSIFIER_RUBRIC_VERSION,
} from "../evals/tool-classifier.js";

type ClassifierValues = {
  live?: boolean;
  list?: boolean;
  case?: string[];
  trials?: string;
  connection?: string;
  provider?: string;
  model?: string;
  "api-key-env"?: string;
  "base-url"?: string;
  pricing?: string;
  "spend-cap-usd"?: string;
  "timeout-ms"?: string;
  output?: string;
};

/**
 * Live calibration of the unknown-tool classifier against the reviewed examples. Opt in with
 * --live: the default run, and CI, never call a model. The classifier is the product's own
 * adapter on a model connection, and its cost is reported apart from everything else.
 */
export async function runToolClassifierSuite(
  values: ClassifierValues,
  meta: {
    codeRevision: string | null;
    workingDiffHash: string | null;
    readConnection: (file: string) => unknown;
  },
) {
  if (values.list) {
    for (const c of TOOL_CLASSIFIER_EXAMPLES)
      console.log(`${c.id}: expected ${c.expected}${c.shot ? " (shown to the model)" : ""}`);
    return;
  }
  const selected = values.case?.length
    ? TOOL_CLASSIFIER_EXAMPLES.filter((c) => values.case!.includes(c.id))
    : TOOL_CLASSIFIER_EXAMPLES;
  if (
    !selected.length ||
    values.case?.some((id) => !TOOL_CLASSIFIER_EXAMPLES.some((c) => c.id === id))
  )
    throw new Error("Unknown eval case; use --list");
  const trials = Number(values.trials);
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 10)
    throw new Error("Trials must be an integer from 1 to 10");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000)
    throw new Error("Timeout must be at least 1000ms");
  const output = path.resolve(values.output!);
  const results: ToolClassifierCaseResult[] = [];
  const report = {
    version: 1,
    kind: "tool-classifier-calibration-eval",
    startedAt: new Date().toISOString(),
    fixtureVersion: TOOL_CLASSIFIER_EXAMPLES_VERSION,
    rubricVersion: TOOL_CLASSIFIER_RUBRIC_VERSION,
    classifier: null as null | { provider: string; model: string },
    codeRevision: meta.codeRevision,
    workingDiffHash: meta.workingDiffHash,
    controls: { trials, timeoutMs },
    pricing: null as EvalPricing | null,
    spendCapUsd: Number(values["spend-cap-usd"]),
    status: "not-run" as "not-run" | "complete" | "stopped",
    reason: null as string | null,
    costSource:
      "Classifier calls only. Provider reported charge when available, otherwise explicit pricing estimate; unknown stays null.",
    scoring:
      "Held-out agreement is over examples the model was not shown. Unsafe is a suggestion the product would act on that is less careful than the reviewed answer. Errors are unqualified, never passes.",
    cases: selected.map((c) => c.id),
    results,
    summary: summarizeToolClassifier(results),
  };
  const save = () => {
    report.summary = summarizeToolClassifier(results);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(`${output}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    renameSync(`${output}.tmp`, output);
  };
  const notRun = (reason: string): never => {
    report.reason = reason;
    save();
    throw new Error(reason);
  };
  save();
  if (!values.live) notRun("Live classifier execution requires --live; no case was run");
  loadRootEnv();

  const parsed = ModelConnectInputSchema.safeParse(
    values.connection
      ? meta.readConnection(values.connection)
      : {
          provider: values.provider,
          modelId: values.model,
          apiKey: values["api-key-env"] ? process.env[values["api-key-env"]] : undefined,
          baseUrl: values["base-url"],
          label: "Tool classifier",
        },
  );
  if (!parsed.success || !parsed.data.modelId?.trim())
    return notRun(
      "A valid connection is required: --connection with models/connect JSON, or --provider --model --api-key-env",
    );
  const connection = parsed.data;
  const modelId = parsed.data.modelId;
  report.classifier = { provider: connection.provider, model: modelId };
  let pricing: EvalPricing;
  try {
    pricing = validatePricing(JSON.parse(readFileSync(values.pricing!, "utf8")));
  } catch {
    return notRun("Live execution requires --pricing with explicit USD per million rates");
  }
  report.pricing = pricing;
  const budget = new SpendBudget(report.spendCapUsd, pricing);
  const calls: MeasuredCall[] = [];
  const callObserver: ModelCallObserver = {
    beforeCall: (call) => {
      if (call.provider !== connection.provider || call.modelId !== modelId)
        throw new Error("Classifier model has no configured pricing");
      return budget.reserve(
        call.inputTokensEstimate,
        call.maxOutputTokens,
        call.cacheWriteRetention,
      );
    },
    afterCall: (id, usage) => budget.settleUsage(id, usage),
  };
  // Direct source imports keep the adapters barrel, and its database client, out of this suite.
  const { PiAgentRuntime } = await import("../../../adapters/src/pi-runtime.ts");
  const { LlmToolClassifier } = await import("../../../adapters/src/tool-classifier.ts");
  const classifier = new LlmToolClassifier({
    runtime: new PiAgentRuntime({ modelCallObserver: callObserver }),
    checker: { provider: connection.provider, model: modelId },
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    headers: connection.headers,
    // The operator runs evals against the model server they chose, often on loopback.
    allowPrivateEndpoint: true,
    contextWindow: connection.contextWindow ?? undefined,
    maxTokens: connection.maxTokens ?? undefined,
    reasoning: connection.reasoning,
    onUsage: async (usage) => {
      calls.push({ ...usage, id: usage.callId ?? randomUUID() });
    },
    runId: "tool-classifier-eval",
    spaceId: "tool-classifier-eval-space",
    userId: "tool-classifier-eval-user",
    botId: "tool-classifier-eval-bot",
    threadId: "tool-classifier-eval-thread",
    timeoutMs,
  });

  const secrets = [connection.apiKey ?? "", connection.baseUrl ?? ""];
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
  };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);
  try {
    await runToolClassifierCases(classifier, {
      cases: selected,
      trials,
      timeoutMs,
      pricing,
      drainCalls: () => calls.splice(0),
      shouldStop: () => stopRequested,
      onResult: (result) => {
        results.push(result);
        save();
        console.log(
          redact(
            `${result.caseId} trial ${result.trial}: expected ${result.expected}, suggested ${result.suggested}, applied ${result.applied} (${result.outcome}); ${result.latencyMs}ms`,
            secrets,
          ),
        );
      },
    });
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
  report.status = stopRequested ? "stopped" : "complete";
  save();
  const s = report.summary;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  console.log(
    `held-out agreement ${pct(s.heldOutAgreementRate)}; held-out unsafe ${pct(s.heldOutUnsafeRate)}; unqualified ${s.unqualified}; classifier cost ${s.costUsd === null ? "unknown" : `$${s.costUsd.toFixed(6)}`}`,
  );
  if (stopRequested || s.unsafe > 0 || s.unqualified > 0) process.exitCode = 1;
}
