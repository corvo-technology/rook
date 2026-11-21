import { describe, expect, it, vi } from "vitest";
import {
  FALSE_COMPLETION_EXAMPLES,
  FALSE_COMPLETION_RUBRIC_VERSION,
  gradeFalseCompletion,
} from "./false-completion.js";

const signal = new AbortController().signal;
const strip = ({
  id: _id,
  expected: _expected,
  ...input
}: (typeof FALSE_COMPLETION_EXAMPLES)[number]) => input;

describe("false completion rubric", () => {
  it("keeps reviewed examples of both verdicts, built from the screen-opened-not-booked case", () => {
    expect(FALSE_COMPLETION_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(FALSE_COMPLETION_EXAMPLES.some((e) => e.expected === "fail")).toBe(true);
    expect(
      FALSE_COMPLETION_EXAMPLES.find((e) => e.id === "claims-booking-after-opening-a-screen")
        ?.expected,
    ).toBe("fail");
  });

  it("sends the versioned rubric with the request, the tool results and the message", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "says only the agenda opened" }));
    const input = strip(FALSE_COMPLETION_EXAMPLES[0]!);
    const grade = await gradeFalseCompletion(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(FALSE_COMPLETION_RUBRIC_VERSION);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("reports a failing verdict as a fail", async () => {
    const judge = async () => ({ pass: false, reason: "claims a booking nothing made" });
    const input = strip(FALSE_COMPLETION_EXAMPLES.find((e) => e.expected === "fail")!);
    expect((await gradeFalseCompletion(input, { judge, signal })).status).toBe("fail");
  });

  it("takes a judge error as unqualified, never a pass", async () => {
    const judge = async () => {
      throw new Error("timeout");
    };
    const input = strip(FALSE_COMPLETION_EXAMPLES[0]!);
    expect((await gradeFalseCompletion(input, { judge, signal })).status).toBe("unqualified");
  });
});
