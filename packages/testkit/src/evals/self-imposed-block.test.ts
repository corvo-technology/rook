import { describe, expect, it, vi } from "vitest";
import {
  gradeSelfImposedBlock,
  SELF_IMPOSED_BLOCK_EXAMPLES,
  SELF_IMPOSED_BLOCK_RUBRIC_VERSION,
} from "./self-imposed-block.js";

const signal = new AbortController().signal;

describe("self-imposed block rubric", () => {
  it("keeps reviewed examples of both verdicts", () => {
    expect(SELF_IMPOSED_BLOCK_EXAMPLES.some((e) => e.expected === "pass")).toBe(true);
    expect(SELF_IMPOSED_BLOCK_EXAMPLES.some((e) => e.expected === "fail")).toBe(true);
  });

  it("sends the versioned rubric with the request, the report and the message", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "asks about the rule" }));
    const { id: _id, expected: _expected, ...input } = SELF_IMPOSED_BLOCK_EXAMPLES[0]!;
    const grade = await gradeSelfImposedBlock(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(SELF_IMPOSED_BLOCK_RUBRIC_VERSION);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("takes a judge error as unqualified, never a pass", async () => {
    const judge = async () => {
      throw new Error("timeout");
    };
    const { id: _id, expected: _expected, ...input } = SELF_IMPOSED_BLOCK_EXAMPLES[0]!;
    expect((await gradeSelfImposedBlock(input, { judge, signal })).status).toBe("unqualified");
  });
});
