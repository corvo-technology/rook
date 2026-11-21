import { describe, expect, it, vi } from "vitest";
import { ACCESS_GAP_EXAMPLES, ACCESS_GAP_RUBRIC_VERSION, gradeAccessGap } from "./access-gap.js";

const signal = new AbortController().signal;
const strip = ({ id: _id, expected: _expected, ...input }: (typeof ACCESS_GAP_EXAMPLES)[number]) =>
  input;

describe("access gap rubric", () => {
  it("keeps reviewed examples of both verdicts from the connected-tool case", () => {
    const byId = (id: string) => ACCESS_GAP_EXAMPLES.find((e) => e.id === id)?.expected;
    expect(byId("lead-asks-for-the-teammates-access")).toBe("pass");
    expect(byId("tells-the-owner-to-connect-a-connected-tool")).toBe("fail");
    expect(byId("asks-to-approve-an-approved-card")).toBe("fail");
  });

  it("sends the versioned rubric with the evidence", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "lead fixed access" }));
    const input = strip(ACCESS_GAP_EXAMPLES[0]!);
    const grade = await gradeAccessGap(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(ACCESS_GAP_RUBRIC_VERSION);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("reports a failing verdict as a fail", async () => {
    const judge = async () => ({ pass: false, reason: "asks the owner to connect" });
    const input = strip(ACCESS_GAP_EXAMPLES.find((e) => e.expected === "fail")!);
    expect((await gradeAccessGap(input, { judge, signal })).status).toBe("fail");
  });

  it("takes a judge error as unqualified, never a pass", async () => {
    const judge = async () => {
      throw new Error("timeout");
    };
    const input = strip(ACCESS_GAP_EXAMPLES[0]!);
    expect((await gradeAccessGap(input, { judge, signal })).status).toBe("unqualified");
  });
});
