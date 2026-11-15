import type { ModelTier } from "@corvo/contracts";
import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the task set changes, so earlier reports stay comparable. */
export const MODEL_ROUTING_RUBRIC_VERSION = "model-routing-v1";

const RUBRIC = `Rubric ${MODEL_ROUTING_RUBRIC_VERSION}. The evidence holds a task and two answers to it, "first" and "second", from different models; their order carries no meaning. Decide whether the answer named in "candidate" is at least as good as the other for the person who asked. It is at least as good only if it is as correct, as complete against what the task asked for, and as safe: it invents nothing, does not skip a requested part, and does not take or promise an action the task did not ask for. A different style, length or wording is fine, in any language. If the other answer is wrong or incomplete and the candidate is right, the candidate passes. If the candidate is wrong, misses a requested part or invents something the other does not, it fails. Do not reward length or confidence.`;

export type RoutingCase = {
  id: string;
  /** What the agent was made for, as the router reads it. */
  title: string;
  description: string;
  prompt: string;
  /** The tier the router should pick, so a routing change that shifts it is seen. */
  expectedTier: ModelTier;
};

export const MODEL_ROUTING_CASES: RoutingCase[] = [
  {
    id: "triage-urgency",
    title: "Inbox triage",
    description: "Sorts incoming email by urgency",
    prompt:
      "Label each message as urgent, normal or low and give one reason per message.\n1. Subject: Server down in production, customers cannot log in\n2. Subject: Newsletter: ten tips for spring\n3. Subject: Invoice 4471 due Friday",
    expectedTier: "fast",
  },
  {
    id: "summary-notes",
    title: "Support summaries",
    description: "Summarizes support threads",
    prompt:
      "Summarize in two sentences: The customer wrote on Monday that exports fail with a timeout. We asked for the file size, which was 2 GB. On Tuesday we raised the limit to 4 GB and the export worked. The customer confirmed on Wednesday.",
    expectedTier: "fast",
  },
  {
    id: "reply-draft",
    title: "Helper",
    description: "",
    prompt:
      "Draft a polite reply declining a meeting on Thursday and proposing next Tuesday morning instead.",
    expectedTier: "main",
  },
  {
    id: "approved-send",
    title: "Inbox triage",
    description: "Sorts incoming email",
    prompt:
      "The user approved sending the reply. State in one sentence what will be sent and to whom: reply to dana@example.test confirming the invoice 4471 was paid.",
    expectedTier: "main",
  },
  {
    id: "refactor-snippet",
    title: "Helper",
    description: "",
    prompt:
      "What is wrong with this and how do I fix it?\n```ts\nfunction total(items) {\n  let sum = 0;\n  for (const item of items) sum += item.price * item.qty\n  return sum.toFixed(2) + 1;\n}\n```",
    expectedTier: "strong",
  },
  {
    id: "migration-plan",
    title: "Software engineer",
    description: "Plans and carries out code changes",
    prompt:
      "Plan the steps to move a table's primary key from an integer to a UUID without downtime, naming what could go wrong at each step.",
    expectedTier: "strong",
  },
];

export type RoutingGrade = { status: "pass" | "fail" | "unqualified"; reason: string };

/**
 * Whether Automatic's answer holds up against the fixed strong model's. The comparison is the
 * judge's, by meaning; with no judge, or a judge that errors, the case is unqualified, never a pass.
 */
export async function gradeRouting(
  testCase: RoutingCase,
  answers: { auto: string; strong: string },
  /** Which answer is shown first, alternated by the caller so neither position is favored. */
  autoFirst: boolean,
  judged?: { judge: EvalJudge; signal: AbortSignal },
): Promise<RoutingGrade> {
  if (!answers.auto.trim()) return { status: "fail", reason: "Automatic returned no answer" };
  if (!judged) return { status: "unqualified", reason: "no judge was given" };
  try {
    const judgment = await judged.judge(
      {
        rubric: RUBRIC,
        evidence: {
          task: testCase.prompt,
          first: autoFirst ? answers.auto : answers.strong,
          second: autoFirst ? answers.strong : answers.auto,
          candidate: autoFirst ? "first" : "second",
        },
      },
      judged.signal,
    );
    return { status: judgment.pass ? "pass" : "fail", reason: judgment.reason };
  } catch (error) {
    return {
      status: "unqualified",
      reason: `the judge could not decide: ${error instanceof Error ? error.message : "error"}`,
    };
  }
}
