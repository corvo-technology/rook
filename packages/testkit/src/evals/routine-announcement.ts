import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the reviewed examples change, so earlier reports stay comparable. */
export const ROUTINE_ANNOUNCEMENT_RUBRIC_VERSION = "routine-announcement-v1";

const RUBRIC = `Rubric ${ROUTINE_ANNOUNCEMENT_RUBRIC_VERSION}. The evidence holds the routines a new AI teammate set up (name and schedule) and the one message it then sent to the person. Pass only if the message (1) says in plain everyday words what was set up and when, matching the routines given and inventing none, (2) is short, one to three sentences, (3) asks at most one easy question, such as whether another time suits them, and (4) uses the person's language. Fail if it lists every detail like a report, announces itself by role, asks the person to do setup work, claims something runs that was not given, or gets a day or time wrong. Equivalent wording and other languages are fine. Do not reward length.`;

export type RoutineAnnouncementExample = {
  id: string;
  /** Reviewed by a person; the judge is calibrated against these. */
  expected: "pass" | "fail";
  routines: string[];
  message: string;
};

export const ROUTINE_ANNOUNCEMENT_EXAMPLES: RoutineAnnouncementExample[] = [
  {
    id: "human-two-routines",
    expected: "pass",
    routines: ["Checagem de cobranças, toda segunda às 9h", "Status da manhã, dias úteis às 9h"],
    message:
      "Deixei uma checagem das cobranças toda segunda às 9h e um status da manhã nos dias úteis. Quer outro horário?",
  },
  {
    id: "english-human",
    expected: "pass",
    routines: ["Content ideas, Monday at 9:00"],
    message: "I set up a Monday 9am round of post ideas for you. Want a different time?",
  },
  {
    id: "wrong-time",
    expected: "fail",
    routines: ["Checagem de cobranças, toda segunda às 9h"],
    message: "Deixei a checagem das cobranças toda sexta às 18h. Quer mudar?",
  },
  {
    id: "report-style",
    expected: "fail",
    routines: ["Status da manhã, dias úteis às 9h"],
    message:
      "Configuração concluída. Rotina: Status da manhã. Frequência: segunda a sexta. Horário: 09:00. Fuso: padrão. Escopo: alertas, taxas de erro, painéis. Próxima execução: amanhã.",
  },
  {
    id: "asks-for-setup",
    expected: "fail",
    routines: ["Week plan, Monday at 8:30"],
    message:
      "To get started, please tell me your timezone, your preferred days, your notification channel and your goals so I can configure your routines.",
  },
];

export type RoutineAnnouncementGrade = { status: "pass" | "fail" | "unqualified"; reason: string };

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export async function gradeRoutineAnnouncement(
  input: { routines: string[]; message: string },
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<RoutineAnnouncementGrade> {
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
