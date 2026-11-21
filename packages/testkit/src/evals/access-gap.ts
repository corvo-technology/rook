import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or its reviewed examples change, so earlier reports stay comparable. */
export const ACCESS_GAP_RUBRIC_VERSION = "access-gap-v1";

export type AccessGapGrade = {
  status: "pass" | "fail" | "unqualified";
  reason: string;
};

const RUBRIC = `Rubric ${ACCESS_GAP_RUBRIC_VERSION}. The evidence holds what the owner asked, which tools the lead agent has connected, what a teammate it delegated to reported, the tool calls the lead made next, and the lead's final message to the owner. Pass only if the teammate lacked access to a tool the lead has and the lead fixed that itself (it asked for the teammate's access through connect_app, naming every teammate that needs it in one call, or it did the work itself) and carried on with the request. Fail if the message tells the owner to connect, set up or authorize a tool that the evidence shows is already connected, if it relays the teammate's "no access" as the owner's problem, or if it asks the owner to approve a card the evidence shows is already approved. Asking the owner to approve one pending access card is fine. Equivalent wording and other languages are fine.`;

export type AccessGapInput = {
  request: string;
  leadTools: string;
  teammateReport: string;
  leadCalls: string;
  message: string;
};

export type AccessGapExample = AccessGapInput & { id: string; expected: "pass" | "fail" };

const REQUEST = "Analise minha agenda de hoje.";
const LEAD_TOOLS = "The lead has the connected clinic server's appointment tools.";
const REPORT = "Reception: I have no agenda tool available, so I cannot see the appointments.";

export const ACCESS_GAP_EXAMPLES: AccessGapExample[] = [
  {
    id: "lead-asks-for-the-teammates-access",
    expected: "pass",
    request: REQUEST,
    leadTools: LEAD_TOOLS,
    teammateReport: REPORT,
    leadCalls: 'connect_app {"app":"clinic","agents":["Reception"]} returned status pending',
    message:
      "A Recepção ainda não tinha acesso à agenda. Deixei um cartão aqui para você aprovar; assim que aprovar eu sigo com a análise.",
  },
  {
    id: "lead-does-the-work-itself",
    expected: "pass",
    request: REQUEST,
    leadTools: LEAD_TOOLS,
    teammateReport: REPORT,
    leadCalls: "mcp list_appointments returned 14 appointments for today",
    message:
      "Hoje são 14 consultas: 6 pela manhã e 8 à tarde. Dois horários seguidos estão vagos às 11h.",
  },
  {
    id: "tells-the-owner-to-connect-a-connected-tool",
    expected: "fail",
    request: REQUEST,
    leadTools: LEAD_TOOLS,
    teammateReport: REPORT,
    leadCalls: "none",
    message:
      "A Recepção diz que não tem acesso à agenda. Conecte a agenda da clínica para eu analisar.",
  },
  {
    id: "asks-to-approve-an-approved-card",
    expected: "fail",
    request: REQUEST,
    leadTools: `${LEAD_TOOLS} The access card for Reception shows approved.`,
    teammateReport: REPORT,
    leadCalls: "none",
    message: "Aprove o cartão para liberar o acesso à agenda para a Recepção.",
  },
];

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export async function gradeAccessGap(
  input: AccessGapInput,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<AccessGapGrade> {
  try {
    const judgment = await judged.judge({ rubric: RUBRIC, evidence: input }, judged.signal);
    return { status: judgment.pass ? "pass" : "fail", reason: judgment.reason };
  } catch (error) {
    return {
      status: "unqualified",
      reason: `the judge could not decide: ${error instanceof Error ? error.message : "error"}`,
    };
  }
}
