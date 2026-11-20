import { describe, expect, it, vi } from "vitest";
import {
  gradeResearchReport,
  RESEARCH_REPORT_EXAMPLES,
  RESEARCH_REPORT_RUBRIC_VERSION,
} from "./research-report.js";

const signal = new AbortController().signal;
const [example] = RESEARCH_REPORT_EXAMPLES;
const input = {
  question: example?.question ?? "",
  sources: example?.sources ?? [],
  report: example?.report ?? "",
};

describe("gradeResearchReport", () => {
  it("keeps reviewed examples of both verdicts", () => {
    expect(RESEARCH_REPORT_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(RESEARCH_REPORT_EXAMPLES.some((e) => e.expected === "fail")).toBe(true);
  });

  it("sends the versioned rubric with the question, the sources and the report to the judge", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "summary, cited findings, one step" }));
    const grade = await gradeResearchReport(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(RESEARCH_REPORT_RUBRIC_VERSION);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("takes a failing verdict as a failure and a judge error as unqualified", async () => {
    expect(
      (
        await gradeResearchReport(input, {
          judge: async () => ({ pass: false, reason: "cites a source that is not there" }),
          signal,
        })
      ).status,
    ).toBe("fail");
    expect(
      (
        await gradeResearchReport(input, {
          judge: async () => {
            throw new Error("timeout");
          },
          signal,
        })
      ).status,
    ).toBe("unqualified");
  });

  it("grades every reviewed example as its reviewer did when the judge agrees", async () => {
    // A stand-in judge that returns each example's reviewed verdict; real calibration is opt-in.
    for (const reviewed of RESEARCH_REPORT_EXAMPLES) {
      const grade = await gradeResearchReport(reviewed, {
        judge: async () => ({ pass: reviewed.expected === "pass", reason: "reviewed" }),
        signal,
      });
      expect(grade.status).toBe(reviewed.expected);
    }
  });
});
