import { describe, expect, it, vi } from "vitest";
import {
  FIRST_GREETING_EXAMPLES,
  FIRST_GREETING_RUBRIC_VERSION,
  gradeFirstGreeting,
} from "./first-greeting.js";

const signal = new AbortController().signal;

describe("gradeFirstGreeting", () => {
  it("keeps reviewed examples of both verdicts", () => {
    expect(FIRST_GREETING_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(FIRST_GREETING_EXAMPLES.some((e) => e.expected === "fail")).toBe(true);
  });

  it("sends the versioned rubric and only the greeting to the judge", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "warm and short" }));
    const grade = await gradeFirstGreeting("Oi!", { judge, signal });
    const input = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(input.rubric).toContain(FIRST_GREETING_RUBRIC_VERSION);
    expect(input.evidence).toEqual({ greeting: "Oi!" });
    expect(grade.status).toBe("pass");
  });

  it("takes a failing verdict as a failure", async () => {
    const grade = await gradeFirstGreeting("x", {
      judge: async () => ({ pass: false, reason: "announces its role" }),
      signal,
    });
    expect(grade.status).toBe("fail");
  });

  it("leaves the case unqualified when the judge errors", async () => {
    const grade = await gradeFirstGreeting("x", {
      judge: async () => {
        throw new Error("timeout");
      },
      signal,
    });
    expect(grade.status).toBe("unqualified");
  });
});
