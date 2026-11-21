import type {
  ConsultationAction,
  ConsultationActionKind,
  ConsultationTurn,
} from "@corvo/contracts";
import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the reviewed examples change, so earlier reports stay comparable. */
export const CONSULTATION_ACTIONS_RUBRIC_VERSION = "consultation-actions-v1";

/**
 * Two reviewed examples calibrate the judge: one faithful list and one that invents. They are part
 * of the rubric text, so changing them bumps the version.
 */
const REVIEWED_EXAMPLES = `Reviewed example A (pass). Transcript: the professional says to take amoxicillin 500 mg every 8 hours for 7 days and to come back in a week. Actions: a prescription with one item {drug: amoxicillin, dose: 500 mg, posology: every 8 hours, duration: 7 days} and a follow-up with whenText "in a week". Every value is in the transcript. Reviewed example B (fail). Same transcript; the prescription lists "ibuprofen 400 mg" as well, or states a duration of 10 days. Nothing was said about that drug or that duration.`;

const RUBRIC = `Rubric ${CONSULTATION_ACTIONS_RUBRIC_VERSION}. The evidence holds a consultation transcript (numbered lines), the consultation date and time zone, and the actions an assistant proposed from it. Pass only if (1) every proposed action was actually agreed in the conversation, not merely discussed, hypothesised or declined; (2) every detail of every action (drug, dose, posology, duration, exam, date and time, reason, days, message) is stated in the transcript or follows from it and the consultation date by plain calendar arithmetic, nothing invented or completed; (3) a date or time is correct for the consultation date given; and (4) no agreed prescription, exam request, return visit, certificate or patient guidance is missing. Wording may differ from the transcript and may be in another language. Fail on any invented action or detail, or an agreed action that is left out. Do not reward length. ${REVIEWED_EXAMPLES}`;

export type ConsultationActionsCase = {
  id: string;
  /** Consultation date, as the pipeline gives it to the model. */
  consultedAt: string;
  timeZone: string;
  transcript: ConsultationTurn[];
  /** The kinds a correct list holds, each once; empty when nothing was agreed. */
  expected: ConsultationActionKind[];
};

const turn = (speaker: ConsultationTurn["speaker"], text: string, i: number): ConsultationTurn => ({
  speaker,
  startMs: i * 5000,
  text,
});

const script = (lines: Array<[ConsultationTurn["speaker"], string]>) =>
  lines.map(([speaker, text], i) => turn(speaker, text, i));

export const CONSULTATION_ACTIONS_CASES: ConsultationActionsCase[] = [
  {
    // Tuesday 1 December 2026, 10:00 in São Paulo.
    id: "return-prescription-exam",
    consultedAt: "2026-12-01T13:00:00.000Z",
    timeZone: "America/Sao_Paulo",
    expected: ["follow_up", "prescription", "exam_request"],
    transcript: script([
      ["patient", "Doutor, o dente de trás está doendo muito quando eu mastigo."],
      [
        "professional",
        "Pelo exame clínico há uma inflamação ao redor do molar. Vou pedir uma radiografia panorâmica para ver melhor.",
      ],
      ["patient", "Certo, posso fazer essa semana."],
      [
        "professional",
        "Vou prescrever amoxicilina 500 mg, uma cápsula de 8 em 8 horas, por 7 dias.",
      ],
      [
        "professional",
        "Quero te ver de novo na terça que vem, às 14 horas, para avaliar a resposta ao tratamento.",
      ],
      ["patient", "Combinado, terça às 14h."],
    ]),
  },
  {
    id: "discussed-not-agreed",
    consultedAt: "2026-12-01T13:00:00.000Z",
    timeZone: "America/Sao_Paulo",
    expected: [],
    transcript: script([
      ["patient", "Será que eu preciso de algum exame?"],
      [
        "professional",
        "Por enquanto não, o exame clínico está bom. Se a dor voltar, talvez a gente precise de uma radiografia, mas não é o caso agora.",
      ],
      [
        "professional",
        "Não vou prescrever nenhum remédio, só continue a higiene normal. Pode me procurar quando quiser.",
      ],
      ["patient", "Obrigado, doutor."],
    ]),
  },
  {
    id: "certificate-and-guidance",
    consultedAt: "2026-12-01T13:00:00.000Z",
    timeZone: "America/Sao_Paulo",
    expected: ["certificate", "patient_message"],
    transcript: script([
      ["patient", "Preciso de um atestado, não consigo trabalhar assim."],
      ["professional", "Vou emitir um atestado de 2 dias para você repousar."],
      [
        "professional",
        "E depois da extração, não faça bochecho nas primeiras 24 horas e evite alimentos quentes. Vou pedir para a recepção te mandar isso por mensagem.",
      ],
      ["patient", "Tudo bem, obrigado."],
    ]),
  },
];

export type ConsultationActionsGrade = {
  status: "pass" | "fail" | "unqualified";
  reason: string;
};

/** What a run produced: the actions the pipeline's parser kept, or an answer that held no JSON. */
export type ConsultationActionsOutcome =
  | { kind: "actions"; actions: ConsultationAction[] }
  | { kind: "unparsed" };

/** The facts a judge needs, and nothing else from the run. */
export function consultationActionsEvidence(
  testCase: ConsultationActionsCase,
  actions: readonly ConsultationAction[],
) {
  return {
    consultedAt: testCase.consultedAt,
    timeZone: testCase.timeZone,
    transcript: testCase.transcript.map((t, i) => ({ line: i, speaker: t.speaker, text: t.text })),
    actions: actions.map(({ kind, title, detail, payload, evidence }) => ({
      kind,
      title,
      detail,
      payload,
      evidence,
    })),
  };
}

/** The structured contract, graded without a judge: exactly the expected kinds, once each. */
function observableEffect(
  testCase: ConsultationActionsCase,
  outcome: ConsultationActionsOutcome,
): ConsultationActionsGrade | null {
  if (outcome.kind !== "actions")
    return { status: "unqualified", reason: "the model's answer held no list of actions" };
  const kinds = outcome.actions.map((a) => a.kind).sort();
  const wanted = [...testCase.expected].sort();
  const extra = kinds.filter((k) => !wanted.includes(k));
  if (extra.length)
    return { status: "fail", reason: `proposed ${extra.join(", ")}, which was not agreed` };
  const missing = wanted.filter((k) => !kinds.includes(k));
  if (missing.length) return { status: "fail", reason: `left out ${missing.join(", ")}` };
  if (kinds.length !== wanted.length) return { status: "fail", reason: "proposed one kind twice" };
  return null;
}

/**
 * Grades the kinds deterministically; the faithfulness of the details is the judge's, opt-in. A
 * judge that errors leaves the case unqualified, never passed.
 */
export async function gradeConsultationActions(
  testCase: ConsultationActionsCase,
  outcome: ConsultationActionsOutcome,
  judged?: { judge: EvalJudge; signal: AbortSignal },
): Promise<ConsultationActionsGrade> {
  const failed = observableEffect(testCase, outcome);
  if (failed) return failed;
  if (!judged || outcome.kind !== "actions" || testCase.expected.length === 0)
    return { status: "pass", reason: "observable effect" };
  try {
    const judgment = await judged.judge(
      { rubric: RUBRIC, evidence: consultationActionsEvidence(testCase, outcome.actions) },
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
