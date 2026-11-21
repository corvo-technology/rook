import type { EvalJudge } from "./judge.js";

/** Bump when a rubric or its reviewed examples change, so earlier reports stay comparable. */
export const TICKET_RUBRIC_VERSION = "ticket-handoff-v3";

export type TicketGrade = {
  status: "pass" | "fail" | "unqualified";
  reason: string;
};

async function grade(
  rubric: string,
  evidence: unknown,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<TicketGrade> {
  try {
    const judgment = await judged.judge({ rubric, evidence }, judged.signal);
    return { status: judgment.pass ? "pass" : "fail", reason: judgment.reason };
  } catch (error) {
    return {
      status: "unqualified",
      reason: `the judge could not decide: ${error instanceof Error ? error.message : "error"}`,
    };
  }
}

const RELAY_RUBRIC = `Rubric ${TICKET_RUBRIC_VERSION}/relay. The evidence holds the full result a teammate produced and the message the Chief then showed the person in chat. Pass only if the message (1) is a summary of two to four sentences, (2) gives the headline result in plain words, with the key numbers when there are any, (3) points to where the full result lives (a file, ticket or wiki page) and (4) does not paste or retell the document section by section. Fail if it reproduces the document or long parts of it, is a long list or playbook, or only says it is done with no result or no pointer to it. Equivalent wording and other languages are fine. Do not reward length.`;

export type RelayExample = {
  id: string;
  expected: "pass" | "fail";
  result: string;
  message: string;
};

export const RELAY_EXAMPLES: RelayExample[] = [
  {
    id: "short-with-pointer",
    expected: "pass",
    result: "A 40-section playbook with scripts, objections, cadences and a 34-row contact base.",
    message:
      "The SDR kit is ready: a call script, objection answers and a 5-touch cadence, built on the 34-row base so far. Everything is in the file sdr-kit.md on the ticket RAK-216. The base still needs more rows before the team can start.",
  },
  {
    id: "pointer-in-portuguese",
    expected: "pass",
    result: "Planilha com 120 contatos e notas por cidade.",
    message:
      "A planilha ficou com 120 contatos, 70 de SP e 50 de MG. O arquivo completo está no ticket RAK-12.",
  },
  {
    id: "pastes-the-document",
    expected: "fail",
    result: "A 40-section playbook with scripts, objections, cadences and a 34-row contact base.",
    message:
      "Here is the full playbook. Section 1: Goals. Section 2: Consent and opt-in rules. Section 3: Opening script. Section 4: Objection handling, price. Section 5: Objection handling, timing. Section 6: Cadence day 1. Section 7: Cadence day 3. Section 8: Cadence day 7. Section 9: Metrics. Section 10: Compliance checklist. Section 11: Tooling. Section 12: Escalation rules. Section 13: Weekly review. And so on through the rest of the forty sections.",
  },
  {
    id: "done-without-substance",
    expected: "fail",
    result: "Planilha com 120 contatos e notas por cidade.",
    message: "Pronto, está feito.",
  },
];

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export function gradeRelay(
  input: { result: string; message: string },
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<TicketGrade> {
  return grade(RELAY_RUBRIC, input, judged);
}

const REVIEW_RUBRIC = `Rubric ${TICKET_RUBRIC_VERSION}/review. The evidence holds a ticket's acceptance criteria, what the delivery really contains (the facts a careful reviewer finds by opening the file or counting), the owner's own summary, and the verdict the Chief reached. Pass only if the verdict follows from the real contents, not from the summary: it approves when every criterion is met by the real contents, and when something is missing it sends the ticket back with exactly what is missing (the real count or item), or escalates to the person with what is done, what is missing and one decision. Fail if it approves a delivery whose real contents miss a criterion, if it repeats the owner's claim without a check of its own, or if it sends back a delivery that meets every criterion. Equivalent wording and other languages are fine.`;

export type ReviewExample = {
  id: string;
  expected: "pass" | "fail";
  criteria: string;
  actual: string;
  summary: string;
  verdict: string;
};

export const REVIEW_EXAMPLES: ReviewExample[] = [
  {
    id: "sends-back-short-count",
    expected: "pass",
    criteria: "1,000 rows: A 400, B 400, C 200",
    actual: "The file has 34 rows, all of region A.",
    summary: "Mapping done, base is ready.",
    verdict:
      "Sent back to in progress: the file has 34 rows, all of region A. Missing 966 rows, 366 of A, 400 of B and 200 of C.",
  },
  {
    id: "approves-when-met",
    expected: "pass",
    criteria: "3 slides with a title each",
    actual: "The deck has 3 slides and each has a title.",
    summary: "Deck delivered.",
    verdict: "Approved and set to done: 3 slides, each with a title.",
  },
  {
    id: "rubber-stamp",
    expected: "fail",
    criteria: "1,000 rows: A 400, B 400, C 200",
    actual: "The file has 34 rows, all of region A.",
    summary: "Mapping done, 1,000 rows delivered.",
    verdict: "Approved and set to done. The owner confirms 1,000 rows were delivered.",
  },
  {
    id: "sends-back-a-complete-delivery",
    expected: "fail",
    criteria: "3 slides with a title each",
    actual: "The deck has 3 slides and each has a title.",
    summary: "Deck delivered.",
    verdict: "Sent back to in progress: please double check everything.",
  },
];

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export function gradeReviewVerdict(
  input: Omit<ReviewExample, "id" | "expected">,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<TicketGrade> {
  return grade(REVIEW_RUBRIC, input, judged);
}

const DELEGATION_RUBRIC = `Rubric ${TICKET_RUBRIC_VERSION}/delegation. The evidence holds what the owner asked the Chief for and what the Chief then did (the tool it called with its arguments). Pass only if the way the Chief delegated fits the size of the work. Work that is long, measurable or in many batches (collect or process a large number of items, research many targets) must go to the agent as a ticket whose acceptance criteria state a measurable target (the count and split to deliver), with blockedBy when parts must run in order. A plain message to the agent is not enough for that work. A quick question or a short task may go as a plain message and must not become a ticket. Fail if big work is sent as a plain message, if the ticket has no measurable criteria, or if a quick question is turned into a ticket. Equivalent wording and other languages are fine.`;

export type DelegationExample = {
  id: string;
  expected: "pass" | "fail";
  request: string;
  action: string;
};

export const DELEGATION_EXAMPLES: DelegationExample[] = [
  {
    id: "big-collection-as-ticket",
    expected: "pass",
    request: "Finish collecting 1,000 barbershops for the SDR team, by region.",
    action:
      'ticket_create(title "Collect 1,000 barbershops", ownerBotId "rafa", acceptanceCriteria "1,000 rows in the sheet: SP 500, MG 300, RJ 200, each with name, phone and city; no duplicates")',
  },
  {
    id: "sequenced-tickets",
    expected: "pass",
    request: "Collect 500 leads, then write the outreach script for them.",
    action:
      'ticket_create(title "Collect 500 leads", acceptanceCriteria "500 rows with name and email") then ticket_create(title "Outreach script", acceptanceCriteria "One script that names the lead source", blockedBy ["RAK-1"])',
  },
  {
    id: "quick-question-as-message",
    expected: "pass",
    request: "Ask Rafa which city the last list was about.",
    action:
      'message_bot(bot "rafa", intent "question", message "Which city was the last list for?")',
  },
  {
    id: "big-collection-as-message",
    expected: "fail",
    request: "Finish collecting 1,000 barbershops for the SDR team, by region.",
    action:
      'message_bot(bot "rafa", intent "request", message "Please collect the 1,000 barbershops and tell me when done.")',
  },
  {
    id: "ticket-without-target",
    expected: "fail",
    request: "Finish collecting 1,000 barbershops for the SDR team, by region.",
    action:
      'ticket_create(title "Barbershops", ownerBotId "rafa", acceptanceCriteria "Do the work well")',
  },
  {
    id: "quick-question-as-ticket",
    expected: "fail",
    request: "Ask Rafa which city the last list was about.",
    action:
      'ticket_create(title "City of the last list", ownerBotId "rafa", acceptanceCriteria "Answer")',
  },
];

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export function gradeDelegation(
  input: { request: string; action: string },
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<TicketGrade> {
  return grade(DELEGATION_RUBRIC, input, judged);
}

const GRANULARITY_RUBRIC = `Rubric ${TICKET_RUBRIC_VERSION}/granularity. The evidence holds the goal an agent was working on and the tickets it created for it (each with a title and its description or checklist). Pass only if there is one ticket per deliverable: the unit of work that has its own result and its own acceptance criteria, such as a list, a report, a script or a campaign. The individual items inside a deliverable (each lead, company, contact, row, file or message) belong in that ticket's checklist or description, not in tickets of their own. Several tickets are fine when each is a different deliverable, or a different stage that must run after another. Fail if the agent made a ticket per item of one list or batch, or if it made near-identical tickets for the same piece of work. Fail also if the one ticket it made has no way to hold the items (no checklist, description or measurable target). Equivalent wording and other languages are fine. Do not reward fewer tickets by themselves.`;

export type GranularityExample = {
  id: string;
  expected: "pass" | "fail";
  goal: string;
  tickets: string;
};

export const GRANULARITY_EXAMPLES: GranularityExample[] = [
  {
    id: "one-ticket-with-the-items-inside",
    expected: "pass",
    goal: "Contact the 12 shops on the list and record each answer.",
    tickets:
      'RAK-8 "Contact the 12 shops on the list". Checklist: Shop A, Shop B, Shop C and nine more, each with the answer recorded. Done when all 12 have an answer.',
  },
  {
    id: "separate-deliverables",
    expected: "pass",
    goal: "Prepare the spring campaign: a landing page, an email and a short report.",
    tickets:
      'RAK-3 "Spring landing page"; RAK-4 "Spring email, after the page" (blocked by RAK-3); RAK-5 "Campaign report". Each has its own acceptance criteria.',
  },
  {
    id: "ticket-per-lead",
    expected: "fail",
    goal: "Contact the 12 shops on the list and record each answer.",
    tickets:
      'RAK-8 "Shop A"; RAK-9 "Shop B"; RAK-10 "Shop C"; RAK-11 "Shop D"; and eight more tickets, one per shop, each with the same owner.',
  },
  {
    id: "near-identical-repeats",
    expected: "fail",
    goal: "Fix the broken checkout link.",
    tickets:
      'RAK-20 "Fix checkout link"; RAK-21 "Fix the checkout link"; RAK-22 "Checkout link fix". Same owner and same description.',
  },
  {
    id: "single-ticket-with-no-room-for-the-items",
    expected: "fail",
    goal: "Contact the 12 shops on the list and record each answer.",
    tickets: 'RAK-8 "Shops". No description, no checklist and no target.',
  },
];

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export function gradeTicketGranularity(
  input: { goal: string; tickets: string },
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<TicketGrade> {
  return grade(GRANULARITY_RUBRIC, input, judged);
}
