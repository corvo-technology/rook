import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRunRequest } from "@corvo/adapter-kit";
import { ModelConnectInputSchema } from "@corvo/contracts";
import { loadRootEnv } from "@corvo/core/node/load-root-env";
import type { AvatarPieceCase } from "../evals/avatar-piece.js";
import {
  AVATAR_PIECE_CASES,
  AVATAR_PIECE_FIXTURE_VERSION,
  gradeAvatarPiece,
} from "../evals/avatar-piece.js";
import type { ChannelRouterCase } from "../evals/channel-router.js";
import {
  CHANNEL_ROUTER_CASES,
  CHANNEL_ROUTER_RUBRIC_VERSION,
  gradeChannelRouter,
  routerPromptInput,
} from "../evals/channel-router.js";
import type { DateReminderCase } from "../evals/date-reminder.js";
import {
  DATE_REMINDER_CASES,
  DATE_REMINDER_RUBRIC_VERSION,
  dateReminderInstructions,
  dateReminderPrompt,
  gradeDateReminder,
} from "../evals/date-reminder.js";
import type { EvalJudge } from "../evals/judge.js";
import { createEvalJudge } from "../evals/judge.js";
import type { EvalPricing, MeasuredCall } from "../evals/measurement.js";
import { measureCalls, SpendBudget, validatePricing } from "../evals/measurement.js";
import { redact } from "../evals/report.js";

export type PickEvalValues = {
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

export type PickEvalMeta = {
  codeRevision: string | null;
  workingDiffHash: string | null;
  readConnection: (file: string) => unknown;
};

type Grade = { status: "pass" | "fail" | "unqualified"; reason: string };

/** One suite of single-call, tool-free cases that the product's own prompt and parser answer. */
type PickSuite<C extends { id: string }> = {
  kind: string;
  /** Names what the cases were reviewed against, so reports from different versions stay apart. */
  version: string;
  cases: readonly C[];
  expected: (testCase: C) => string;
  instructions: string;
  prompt: (testCase: C) => string;
  grade: (
    testCase: C,
    answer: string,
    judged?: { judge: EvalJudge; signal: AbortSignal },
  ) => Promise<Grade>;
};

type TrialResult = {
  caseId: string;
  trial: number;
  expected: string;
  status: Grade["status"] | "not-run";
  reason: string | null;
};

/**
 * Runs a pick suite against a live model through the shared, provider-neutral runtime: the
 * product's own prompt, no tools, one call per trial, graded by observable effect and, with a
 * judge connection, by the suite's rubric. The subject's and the judge's costs are reported
 * separately; an unreadable answer or a judge that errors is unqualified, never a pass.
 */
async function runPickSuite<C extends { id: string }>(
  suite: PickSuite<C>,
  values: PickEvalValues,
  meta: PickEvalMeta,
) {
  if (values.list) {
    for (const c of suite.cases) console.log(`${c.id}: expected ${suite.expected(c)}`);
    return;
  }
  const selected = values.case?.length
    ? suite.cases.filter((c) => values.case!.includes(c.id))
    : suite.cases;
  if (!selected.length || values.case?.some((id) => !suite.cases.some((c) => c.id === id)))
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
    kind: suite.kind,
    startedAt: new Date().toISOString(),
    fixtureVersion: suite.version,
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
      "A case passes by observable effect (and by the rubric when a judge is given and the case is judged). An unreadable answer, or a judge that errors, is unqualified, never a pass.",
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
      results.push({
        caseId: c.id,
        trial,
        expected: suite.expected(c),
        status: "not-run",
        reason: null,
      });
  save();
  if (!values.live) notRun("Live execution requires --live; no case was run");
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
    let grade: Grade;
    try {
      for await (const event of subjectRuntime.run(
        {
          botId: id,
          threadId: id,
          runId: id,
          instructions: suite.instructions,
          prompt: suite.prompt(testCase),
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
      grade = await suite.grade(
        testCase,
        answer,
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

/** The channel router's own instructions and prompt, against the roster of each reviewed case. */
export async function runChannelRouterSuite(values: PickEvalValues, meta: PickEvalMeta) {
  const { ROUTER_INSTRUCTIONS, renderRouterPrompt } = await import(
    "../../../../apps/api/src/channel-router.ts"
  );
  return runPickSuite<ChannelRouterCase>(
    {
      kind: "channel-router-eval",
      version: CHANNEL_ROUTER_RUBRIC_VERSION,
      cases: CHANNEL_ROUTER_CASES,
      expected: (c) =>
        c.expected.kind === "nobody"
          ? "nobody"
          : `${c.expected.kind} of ${c.expected.acceptable.join("/")}`,
      instructions: ROUTER_INSTRUCTIONS,
      prompt: (c) => renderRouterPrompt(routerPromptInput(c)),
      grade: gradeChannelRouter,
    },
    values,
    meta,
  );
}

/** The avatar piece pick's own instructions and prompt, one agent per case. */
export async function runAvatarPieceSuite(values: PickEvalValues, meta: PickEvalMeta) {
  const { AVATAR_PIECE_INSTRUCTIONS, avatarPiecePrompt, parseAvatarPiece } = await import(
    "../../../adapters/src/avatar-design.ts"
  );
  return runPickSuite<AvatarPieceCase>(
    {
      kind: "avatar-piece-eval",
      version: AVATAR_PIECE_FIXTURE_VERSION,
      cases: AVATAR_PIECE_CASES,
      expected: (c) => c.acceptable.join("/"),
      instructions: AVATAR_PIECE_INSTRUCTIONS,
      prompt: (c) => avatarPiecePrompt(c.agent),
      grade: async (c, answer) => gradeAvatarPiece(c, parseAvatarPiece(answer)),
    },
    values,
    meta,
  );
}

/** The schedule_create description the product ships, against reviewed conversations. */
export async function runDateReminderSuite(values: PickEvalValues, meta: PickEvalMeta) {
  const { builtinAgentTools } = await import("../../../adapters/src/builtin-tools.ts");
  const description = builtinAgentTools.find((t) => t.name === "schedule_create")!.description;
  return runPickSuite<DateReminderCase>(
    {
      kind: "date-reminder-eval",
      version: DATE_REMINDER_RUBRIC_VERSION,
      cases: DATE_REMINDER_CASES,
      expected: (c) => c.expected,
      instructions: dateReminderInstructions(description),
      prompt: dateReminderPrompt,
      grade: gradeDateReminder,
    },
    values,
    meta,
  );
}
