import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the reviewed examples change, so earlier reports stay comparable. */
export const PROACTIVE_MESSAGE_RUBRIC_VERSION = "proactive-message-v1";

const RUBRIC = `Rubric ${PROACTIVE_MESSAGE_RUBRIC_VERSION}. The evidence holds a message an AI chief of staff sent a person on its own, after watching something in the background. Pass only if all hold: (1) it is two to four sentences; (2) it states the concrete fact with names, dates or numbers; (3) the analysis and a recommendation are already done, not left to the person; (4) it ends with at most one question or offer, and that offer is specific; (5) it sounds like a person who helps, in the person's language, with no greeting, headings or lists. Fail if it only reports that something happened, hands the work back ("what would you like me to do?", "want me to look into it?"), makes several offers, pads with an all-clear or filler, or reads like a notification or a form. Equivalent wording and other languages are fine. Do not reward length.`;

export type ProactiveMessageExample = {
  id: string;
  /** Reviewed by a person; the judge is calibrated against these. */
  expected: "pass" | "fail";
  message: string;
};

export const PROACTIVE_MESSAGE_EXAMPLES: ProactiveMessageExample[] = [
  {
    id: "calendar-conflict-analysed",
    expected: "pass",
    message:
      "Na segunda (23/11), sua reunião 'Carlos <> Pedro', das 9:00 às 11:00, bate com o 'Aquecimento SBF', das 9:30 às 10:30. Como a integração é em grupo, o mais fácil é remarcar com o Carlos. Quer que eu procure outro horário livre na sua agenda para sugerir a ele?",
  },
  {
    id: "stuck-ticket-with-cause",
    expected: "pass",
    message:
      "The invoice export ticket (#4) has been blocked since Tuesday: it waits on the API key the vendor never sent. I drafted a short reminder to them with the exact request. Want me to send it?",
  },
  {
    id: "bare-notification",
    expected: "fail",
    message: "Heads up: you have a calendar conflict on Monday.",
  },
  {
    id: "hands-the-work-back",
    expected: "fail",
    message:
      "Oi! Notei que há um problema na sua agenda de segunda. Quer que eu dê uma olhada e veja o que dá para fazer? Posso também checar seus e-mails se preferir.",
  },
  {
    id: "all-clear-filler",
    expected: "fail",
    message:
      "Good morning! I checked your calendar, email, board and deploys and everything looks fine. Nothing needs your attention right now. I'll keep watching and let you know.",
  },
];

export type ProactiveMessageGrade = { status: "pass" | "fail" | "unqualified"; reason: string };

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export async function gradeProactiveMessage(
  message: string,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<ProactiveMessageGrade> {
  try {
    const judgment = await judged.judge({ rubric: RUBRIC, evidence: { message } }, judged.signal);
    return { status: judgment.pass ? "pass" : "fail", reason: judgment.reason };
  } catch (error) {
    return {
      status: "unqualified",
      reason: `the judge could not decide: ${error instanceof Error ? error.message : "error"}`,
    };
  }
}
