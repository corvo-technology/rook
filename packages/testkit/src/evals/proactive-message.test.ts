import { describe, expect, it, vi } from "vitest";
import {
  gradeProactiveMessage,
  PROACTIVE_MESSAGE_EXAMPLES,
  PROACTIVE_MESSAGE_RUBRIC_VERSION,
} from "./proactive-message.js";

const signal = new AbortController().signal;

describe("gradeProactiveMessage", () => {
  it("keeps reviewed examples of both verdicts", () => {
    expect(PROACTIVE_MESSAGE_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(PROACTIVE_MESSAGE_EXAMPLES.filter((e) => e.expected === "fail").length).toBeGreaterThan(
      1,
    );
  });

  it("sends the versioned rubric and only the message to the judge", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "analysis done, one offer" }));
    const grade = await gradeProactiveMessage("Olá", { judge, signal });
    const input = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(input.rubric).toContain(PROACTIVE_MESSAGE_RUBRIC_VERSION);
    expect(input.evidence).toEqual({ message: "Olá" });
    expect(grade.status).toBe("pass");
  });

  it("takes a failing verdict as a failure", async () => {
    const grade = await gradeProactiveMessage("x", {
      judge: async () => ({ pass: false, reason: "hands the work back" }),
      signal,
    });
    expect(grade.status).toBe("fail");
  });

  it("leaves the case unqualified when the judge errors", async () => {
    const grade = await gradeProactiveMessage("x", {
      judge: async () => {
        throw new Error("timeout");
      },
      signal,
    });
    expect(grade.status).toBe("unqualified");
  });
});
