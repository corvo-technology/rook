import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunRequest } from "@corvo/adapter-kit";
import { ModelConnectInputSchema } from "@corvo/contracts";
import {
  buildCuratorPrompt,
  CURATOR_RULES,
  curatorSystemPrompt,
  parseCuratorOutput,
} from "@corvo/core";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import type { EvalJudge } from "../evals/judge.js";
import { createEvalJudge } from "../evals/judge.js";
import type { EvalPricing, MeasuredCall } from "../evals/measurement.js";
import { measureCalls, SpendBudget, validatePricing } from "../evals/measurement.js";
import { redact } from "../evals/report.js";
import type {
  WikiCuratorCase,
  WikiCuratorGrade,
  WikiCuratorOutcome,
} from "../evals/wiki-curator.js";
import {
  gradeWikiCurator,
  WIKI_CURATOR_CASES,
  WIKI_CURATOR_RUBRIC_VERSION,
} from "../evals/wiki-curator.js";

type WikiCuratorEvalValues = {
  live?: boolean;
  list?: boolean;
  case?: string[];
  trials?: string;
  connection?: string;
  pricing?: string;
  "judge-connection"?: string;
  "judge-pricing"?: string;
  "spend-cap-usd"?: string;
  "timeout-ms"?: string;
  output?: string;
};

/** What a model's answer comes to: not a proposal at all, or the operations it would keep. */
export function wikiCuratorOutcome(answer: string): WikiCuratorOutcome {
  const proposal = parseCuratorOutput(answer);
  if (!proposal) return { kind: "unparsed" };
  return { kind: "proposal", ops: proposal.worth ? proposal.ops : [] };
}

/** The curator's prompt for a case: its existing pages as the index and related pages. */
function promptFor(testCase: WikiCuratorCase): string {
  return buildCuratorPrompt({
    index: testCase.existing.map((page) => `- [[${page.title}]]`).join("\n"),
    related: testCase.existing,
    pending: [],
    messages: testCase.conversation,
  });
}

type TrialResult = {
  caseId: string;
  trial: number;
  expected: WikiCuratorCase["expected"];
  status: WikiCuratorGrade["status"] | "not-run";
  reason: string | null;
};

/**
 * Runs the curator's rubric against a live model: the product's own prompt, no tools, one call per
 * trial, graded by observable effect and, with a judge connection, by the rubric. The subject's
 * and the judge's costs are reported separately; a judge that errors leaves a case unqualified.
 */
export async function runWikiCuratorSuite(
  values: WikiCuratorEvalValues,
  meta: {
    codeRevision: string | null;
    workingDiffHash: string | null;
    readConnection: (file: string) => unknown;
  },
) {
  if (values.list) {
    for (const c of WIKI_CURATOR_CASES) console.log(`${c.id}: expected ${c.expected}`);
    return;
  }
  const selected = values.case?.length
    ? WIKI_CURATOR_CASES.filter((c) => values.case!.includes(c.id))
    : WIKI_CURATOR_CASES;
  if (!selected.length || values.case?.some((id) => !WIKI_CURATOR_CASES.some((c) => c.id === id)))
    throw new Error("Unknown eval case; use --list");
  const trials = Number(values.trials);
  const timeoutMs = Number(values["timeout-ms"]);
  if (!Number.isSafeInteger(trials) || trials < 1 || trials > 10)
    throw new Error("Trials must be an integer from 1 to 10");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000)
    throw new Error("Timeout must be at least 1000ms");
  const output = path.resolve(values.output!);
  const results: TrialResult[] = [];
  const report = {
    version: 1,
    kind: "wiki-curator-eval",
    startedAt: new Date().toISOString(),
    rubricVersion: WIKI_CURATOR_RUBRIC_VERSION,
    codeRevision: meta.codeRevision,
    workingDiffHash: meta.workingDiffHash,
    controls: { trials, timeoutMs },
    subject: null as null | { provider: string; model: string },
    judge: null as null | { provider: string; model: string },
    spendCapUsd: Number(values["spend-cap-usd"]),
    status: "not-run" as "not-run" | "complete",
    reason: null as string | null,
    subjectCostUsd: null as number | null,
    judgeCostUsd: null as number | null,
    costSource:
      "Subject and judge calls are measured separately, from the provider's reported charge when available, otherwise from explicit pricing; unknown stays null.",
    scoring:
      "A case passes by observable effect (and by the rubric when a judge is given). A model answer that is not a proposal, or a judge that errors, is unqualified, never a pass.",
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
      results.push({ caseId: c.id, trial, expected: c.expected, status: "not-run", reason: null });
  save();
  if (!values.live) notRun("Live curator execution requires --live; no case was run");
  loadRootEnv();

  const parse = (file: string | undefined) => {
    if (!file) return null;
    const parsed = ModelConnectInputSchema.safeParse(meta.readConnection(file));
    return parsed.success && parsed.data.modelId?.trim() ? parsed.data : null;
  };
  const connection = parse(values.connection);
  if (!connection)
    return notRun("A valid subject connection is required: --connection with models/connect JSON");
  let pricing: EvalPricing;
  try {
    pricing = validatePricing(
      values.pricing ? JSON.parse(readFileSync(values.pricing, "utf8")) : null,
    );
  } catch {
    return notRun("Live execution requires --pricing with explicit USD per million rates");
  }
  const judgeConnection = values["judge-connection"] ? parse(values["judge-connection"]) : null;
  let judgePricing: EvalPricing | null = null;
  if (values["judge-connection"]) {
    if (!judgeConnection) return notRun("A valid judge connection is required");
    try {
      judgePricing = validatePricing(
        values["judge-pricing"] ? JSON.parse(readFileSync(values["judge-pricing"], "utf8")) : null,
      );
    } catch {
      return notRun(
        "A judge connection requires --judge-pricing with explicit USD per million rates",
      );
    }
  }
  report.subject = { provider: connection.provider, model: connection.modelId! };
  if (judgeConnection)
    report.judge = { provider: judgeConnection.provider, model: judgeConnection.modelId! };

  const budget = new SpendBudget(report.spendCapUsd, pricing);
  const subjectCalls = new Map<string, MeasuredCall>();
  const judgeCalls = new Map<string, MeasuredCall>();
  const { PiAgentRuntime } = await import("../../../adapters/src/pi-runtime.ts");
  const runtimeFor = (who: { provider: string; modelId?: string | null }, rates: EvalPricing) =>
    new PiAgentRuntime({
      modelCallObserver: {
        beforeCall: (call) => {
          if (call.provider !== who.provider || call.modelId !== who.modelId)
            throw new Error("Eval model has no configured pricing");
          return budget.reserve(
            call.inputTokensEstimate,
            call.maxOutputTokens,
            call.cacheWriteRetention,
            rates,
          );
        },
        afterCall: (id, usage) => budget.settleUsage(id, usage),
      },
    });
  const modelOf = (c: NonNullable<typeof connection>) => ({
    ...c,
    id: c.modelId!,
    allowPrivateEndpoint: true,
    maxImagesPerPrompt: c.maxImagesPerPrompt ?? undefined,
    maxTokens: c.maxTokens ?? 2048,
  });
  const subjectRuntime = runtimeFor(connection, pricing);
  const collect =
    (into: Map<string, MeasuredCall>): NonNullable<AgentRunRequest["onUsage"]> =>
    (usage) => {
      if (usage.callId) into.set(usage.callId, { id: usage.callId, ...usage });
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

  const secrets = [connection.apiKey ?? "", connection.baseUrl ?? ""];
  for (const result of results) {
    const testCase = selected.find((c) => c.id === result.caseId)!;
    const id = randomUUID();
    let answer = "";
    let grade: WikiCuratorGrade;
    try {
      for await (const event of subjectRuntime.run(
        {
          botId: id,
          threadId: id,
          runId: id,
          instructions: curatorSystemPrompt(CURATOR_RULES),
          prompt: promptFor(testCase),
          history: [],
          tools: [],
          model: modelOf(connection),
          allowSilentEmpty: true,
          onUsage: collect(subjectCalls),
        },
        {
          operationId: id,
          traceId: id,
          spaceId: id,
          userId: id,
          signal: AbortSignal.timeout(timeoutMs),
        },
      )) {
        if (event.type === "done" && event.text) answer = event.text.trim();
      }
      grade = await gradeWikiCurator(
        testCase,
        wikiCuratorOutcome(answer),
        judge ? { judge, signal: AbortSignal.timeout(timeoutMs) } : undefined,
      );
    } catch (error) {
      grade = {
        status: "unqualified",
        reason: redact(error instanceof Error ? error.message : "The model call failed", secrets),
      };
    } finally {
      await subjectRuntime.abort(id);
    }
    result.status = grade.status;
    result.reason = grade.reason;
    report.subjectCostUsd = measureCalls([...subjectCalls.values()], pricing).costUsd;
    report.judgeCostUsd = judgePricing
      ? measureCalls([...judgeCalls.values()], judgePricing).costUsd
      : null;
    save();
    console.log(
      `${result.caseId} trial ${result.trial}: expected ${result.expected}, ${grade.status}`,
    );
  }
  report.status = "complete";
  save();
  const s = report.summary;
  console.log(
    `pass ${s.pass}; fail ${s.fail}; unqualified ${s.unqualified}; subject cost ${report.subjectCostUsd === null ? "unknown" : `$${report.subjectCostUsd.toFixed(6)}`}; judge cost ${report.judgeCostUsd === null ? "n/a" : `$${report.judgeCostUsd.toFixed(6)}`}`,
  );
  if (s.fail || s.unqualified) process.exitCode = 1;
}
