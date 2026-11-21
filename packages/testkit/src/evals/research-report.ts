import type { EvalJudge } from "./judge.js";

/** Bump when the rubric or the reviewed examples change, so earlier reports stay comparable. */
export const RESEARCH_REPORT_RUBRIC_VERSION = "research-report-v1";

const RUBRIC = `Rubric ${RESEARCH_REPORT_RUBRIC_VERSION}. The evidence holds a question, the numbered sources a research job read (title and a short excerpt each) and the report the agent posted. Pass only if the report (1) opens with a 2 to 4 sentence plain-words summary that answers the question, (2) then lists key findings, each tied to one or more source numbers like [1], (3) ends with exactly one proposed next step, (4) states only what the sources' excerpts support, with every cited number being one of the sources given and pointing at a source that backs that finding, (5) says what is unknown instead of guessing, and (6) uses the language of the question. Fail if it opens with a preamble or a list instead of the summary, has findings without citations, cites a number that is not a source or a source that does not support the claim, states facts the sources do not support, proposes several next steps or none, or pads with closing remarks. Equivalent wording, other languages and different heading words are fine. Do not reward length.`;

export type ResearchReportEvidence = {
  question: string;
  sources: Array<{ n: number; title: string; excerpt: string }>;
  report: string;
};

export type ResearchReportExample = ResearchReportEvidence & {
  id: string;
  /** Reviewed by a person; the judge is calibrated against these. */
  expected: "pass" | "fail";
};

const PRICING_SOURCES = [
  { n: 1, title: "Rook pricing update", excerpt: "The team plan now costs nine dollars per seat." },
  {
    n: 2,
    title: "Analyst note",
    excerpt: "The change lands in the spring, according to a second report.",
  },
];

export const RESEARCH_REPORT_EXAMPLES: ResearchReportExample[] = [
  {
    id: "summary-findings-next-step",
    expected: "pass",
    question: "What changed in Rook's team pricing?",
    sources: PRICING_SOURCES,
    report:
      "The team plan now costs nine dollars per seat, and the change is expected to land in the spring. One source gives the price and a second gives the timing.\n\nKey findings\n- The team plan costs nine dollars per seat. [1]\n- The change lands in the spring. [2]\n- Whether older plans are affected is not stated.\n\nNext step: compare the new price with the closest competitor's team plan.",
  },
  {
    id: "portuguese-question",
    expected: "pass",
    question: "O que mudou no preço do plano de equipe?",
    sources: PRICING_SOURCES,
    report:
      "O plano de equipe passou a custar nove dólares por pessoa, com chegada prevista para a primavera. O preço vem de uma fonte e a data de outra.\n\nPrincipais achados\n- O plano de equipe custa nove dólares por pessoa. [1]\n- A mudança chega na primavera. [2]\n\nPróximo passo: comparar o novo preço com o plano do concorrente mais próximo.",
  },
  {
    id: "invented-citation",
    expected: "fail",
    question: "What changed in Rook's team pricing?",
    sources: PRICING_SOURCES,
    report:
      "The team plan now costs nine dollars per seat.\n\nKey findings\n- The price is nine dollars. [1]\n- Enterprise plans were cut by half. [4]\n\nNext step: compare it with a competitor.",
  },
  {
    id: "claims-beyond-sources",
    expected: "fail",
    question: "What changed in Rook's team pricing?",
    sources: PRICING_SOURCES,
    report:
      "The team plan now costs nine dollars per seat, and every existing customer will be moved over automatically in March.\n\nKey findings\n- The price is nine dollars. [1]\n- Existing customers move in March. [2]\n\nNext step: tell customers.",
  },
  {
    id: "no-summary-no-citations",
    expected: "fail",
    question: "What changed in Rook's team pricing?",
    sources: PRICING_SOURCES,
    report:
      "Here is everything I found!\n\n- The team plan costs nine dollars.\n- The change is in the spring.\n\nLet me know if you want me to dig deeper, compare competitors, or draft an announcement. I can also set up a recurring check and a summary for your team.",
  },
];

export type ResearchReportGrade = { status: "pass" | "fail" | "unqualified"; reason: string };

/** Judge-only: a judge that errors leaves the case unqualified, never passed. */
export async function gradeResearchReport(
  input: ResearchReportEvidence,
  judged: { judge: EvalJudge; signal: AbortSignal },
): Promise<ResearchReportGrade> {
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
