import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the reviewed examples change, so earlier reports stay comparable. */
export const FIRST_GREETING_RUBRIC_VERSION = "first-greeting-v2";

const RUBRIC = `Rubric ${FIRST_GREETING_RUBRIC_VERSION}. The evidence holds the first message a new AI teammate sent to a person. Pass only if it reads like a warm, capable person who just joined to help: (1) it uses the person's language and plain everyday words, (2) it is short, two or three sentences at most, (3) it offers help lightly and asks at most one easy question or offers a few tappable options. Fail if it announces itself by role or title ("I am X, the Y organizer"), sounds like a project manager or a form ("let's map the commitments to build a realistic routine"), lists categories in a row, explains a plan before the person asked, or uses an em dash or en dash as punctuation (a person chatting writes a comma, a period or a new sentence). Equivalent wording and other languages are fine. Do not reward length.`;

export type FirstGreetingExample = {
  id: string;
  /** Reviewed by a person; the judge is calibrated against these. */
  expected: "pass" | "fail";
  greeting: string;
};

export const FIRST_GREETING_EXAMPLES: FirstGreetingExample[] = [
  {
    id: "robotic-role-announcement",
    expected: "fail",
    greeting:
      "Sou o Chefe, organizador da rotina da Família. Primeiro, vamos mapear os compromissos fixos da semana — escola, trabalho, consultas e atividades — para montar uma rotina realista.",
  },
  {
    id: "human-light-offer",
    expected: "pass",
    greeting:
      "Oi, Ana! Cheguei pra dar uma mão com a casa e a rotina da família. Quer começar por alguma coisa em especial, tipo a semana da escola?",
  },
  {
    id: "english-form-like",
    expected: "fail",
    greeting:
      "Hello! I am your Chief, the workflow coordinator. To get started, please provide your priorities, deadlines, team members and tools so I can build a structured plan.",
  },
  {
    id: "em-dash-chatty",
    expected: "fail",
    greeting: "Bem-vinda, Amanda! Que bom ter você aqui — vamos ajudar no dia a dia de vocês.",
  },
  {
    id: "no-dash-human",
    expected: "pass",
    greeting: "Bem-vinda, Amanda! Que bom ter você aqui. Por onde quer começar?",
  },
  {
    id: "english-human",
    expected: "pass",
    greeting: "Hey Sam, glad to be here! What's the one thing taking up too much of your week?",
  },
];

export type FirstGreetingGrade = { status: "pass" | "fail" | "unqualified"; reason: string };

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export async function gradeFirstGreeting(
  greeting: string,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<FirstGreetingGrade> {
  try {
    const judgment = await judged.judge({ rubric: RUBRIC, evidence: { greeting } }, judged.signal);
    return { status: judgment.pass ? "pass" : "fail", reason: judgment.reason };
  } catch (error) {
    return {
      status: "unqualified",
      reason: `the judge could not decide: ${error instanceof Error ? error.message : "error"}`,
    };
  }
}
