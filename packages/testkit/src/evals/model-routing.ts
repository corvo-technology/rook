import type { ModelTier } from "@corvo/contracts";
import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the task set changes, so earlier reports stay comparable. */
export const MODEL_ROUTING_RUBRIC_VERSION = "model-routing-v2";

const RUBRIC = `Rubric ${MODEL_ROUTING_RUBRIC_VERSION}. The evidence holds a task and two answers to it, "first" and "second", from different models; their order carries no meaning. Decide whether the answer named in "candidate" is at least as good as the other for the person who asked. It is at least as good only if it is as correct, as complete against what the task asked for, and as safe: it invents nothing, does not skip a requested part, and does not take or promise an action the task did not ask for. A different style, length or wording is fine, in any language. If the other answer is wrong or incomplete and the candidate is right, the candidate passes. If the candidate is wrong, misses a requested part or invents something the other does not, it fails. Do not reward length or confidence.`;

const ESCALATION_RUBRIC = `Rubric ${MODEL_ROUTING_RUBRIC_VERSION}, escalation. The evidence holds a task, the "tier" of the model that took it, that model's "decision" ("escalated" when it asked for a stronger model, "answered" when it replied itself), the "text" it gave (its reason, or its answer), and a reviewed "reference" saying whether escalating is appropriate for this task. The decision passes when it agrees with the reference: escalating is appropriate only for genuinely hard reasoning, code or planning that a model of this tier would likely get wrong, never for a routine, short or simple task; answering is appropriate when a model of this tier can do the task well. An escalation also needs a reason that names what is hard about the task; a vague or reflexive reason fails even when the reference allows escalating. An answer that is wrong, or that skips what the task asked for, fails when the reference says escalating was appropriate and passes otherwise only if it is correct. Wording, length and language do not matter.`;

/** The marker a model puts first when it would call request_stronger_model in the eval. */
export const ESCALATION_MARKER = "REQUEST_STRONGER_MODEL:";

export type RoutingCase = {
  id: string;
  /** What the agent was made for, as the router reads it. */
  title: string;
  description: string;
  prompt: string;
  /** The tier the router should pick, so a routing change that shifts it is seen. */
  expectedTier: ModelTier;
  /** A case about the agent asking for a stronger model: whether doing so is the right call. */
  escalation?: "appropriate" | "unneeded";
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
  {
    id: "escalate-convergence-proof",
    title: "Helper",
    description: "",
    prompt:
      "Design a merge rule for offline edits to a shared spreadsheet so every replica converges whatever the order of delivery, prove it converges, and name the trade-offs against operational transforms.",
    expectedTier: "main",
    escalation: "appropriate",
  },
  {
    id: "escalate-legal-reasoning",
    title: "Inbox triage",
    description: "Sorts incoming email",
    prompt:
      "Assess whether clause 9.2 of the attached supplier contract lets us terminate for convenience when clause 14 caps liability, and what we risk if we are wrong.",
    expectedTier: "fast",
    escalation: "appropriate",
  },
  {
    id: "escalate-friendly-rewrite",
    title: "Helper",
    description: "",
    prompt: 'Make this sentence sound friendlier: "Your request has been denied."',
    expectedTier: "main",
    escalation: "unneeded",
  },
  {
    id: "escalate-triage-label",
    title: "Inbox triage",
    description: "Sorts incoming email",
    prompt: "Is this email urgent or normal? Subject: Lunch on Friday?",
    expectedTier: "fast",
    escalation: "unneeded",
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

/**
 * Whether a model's choice to ask for a stronger model, or to answer, was the right call for the
 * task. The judge decides by the escalation rubric and a reviewed reference; with no judge, or a
 * judge that errors, the case is unqualified, never a pass.
 */
export async function gradeEscalation(
  testCase: RoutingCase,
  outcome: { tier: ModelTier; escalated: boolean; text: string },
  judged?: { judge: EvalJudge; signal: AbortSignal },
): Promise<RoutingGrade> {
  if (!outcome.text.trim()) return { status: "fail", reason: "The model returned nothing" };
  if (!judged) return { status: "unqualified", reason: "no judge was given" };
  try {
    const judgment = await judged.judge(
      {
        rubric: ESCALATION_RUBRIC,
        evidence: {
          task: testCase.prompt,
          tier: outcome.tier,
          decision: outcome.escalated ? "escalated" : "answered",
          text: outcome.text,
          reference:
            testCase.escalation === "appropriate"
              ? "escalating is appropriate"
              : "escalating is not appropriate",
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
