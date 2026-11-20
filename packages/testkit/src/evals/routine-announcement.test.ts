import { describe, expect, it, vi } from "vitest";
import {
  gradeRoutineAnnouncement,
  ROUTINE_ANNOUNCEMENT_EXAMPLES,
  ROUTINE_ANNOUNCEMENT_RUBRIC_VERSION,
} from "./routine-announcement.js";

const signal = new AbortController().signal;
const input = { routines: ["Week plan, Monday at 8:30"], message: "Set up a Monday plan." };

describe("gradeRoutineAnnouncement", () => {
  it("keeps reviewed examples of both verdicts", () => {
    expect(ROUTINE_ANNOUNCEMENT_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(ROUTINE_ANNOUNCEMENT_EXAMPLES.some((e) => e.expected === "fail")).toBe(true);
  });

  it("sends the versioned rubric with the routines and the message to the judge", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "accurate and short" }));
    const grade = await gradeRoutineAnnouncement(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(ROUTINE_ANNOUNCEMENT_RUBRIC_VERSION);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("takes a failing verdict as a failure and a judge error as unqualified", async () => {
    expect(
      (
        await gradeRoutineAnnouncement(input, {
          judge: async () => ({ pass: false, reason: "wrong day" }),
          signal,
        })
      ).status,
    ).toBe("fail");
    expect(
      (
        await gradeRoutineAnnouncement(input, {
          judge: async () => {
            throw new Error("timeout");
          },
          signal,
        })
      ).status,
    ).toBe("unqualified");
  });
});
