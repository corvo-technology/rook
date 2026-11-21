import { describe, expect, it, vi } from "vitest";
import {
  DELEGATION_EXAMPLES,
  GRANULARITY_EXAMPLES,
  gradeDelegation,
  gradeRelay,
  gradeReviewVerdict,
  gradeTicketGranularity,
  RELAY_EXAMPLES,
  REVIEW_EXAMPLES,
  TICKET_RUBRIC_VERSION,
} from "./ticket-handoff.js";

const signal = new AbortController().signal;

describe("ticket handoff rubrics", () => {
  it("keep reviewed examples of both verdicts", () => {
    for (const examples of [
      RELAY_EXAMPLES,
      REVIEW_EXAMPLES,
      DELEGATION_EXAMPLES,
      GRANULARITY_EXAMPLES,
    ]) {
      expect(examples.some((e) => e.expected === "pass")).toBe(true);
      expect(examples.some((e) => e.expected === "fail")).toBe(true);
    }
  });

  it("sends the versioned relay rubric with the result and the message", async () => {
    const judge = vi.fn(async () => ({
      pass: true,
      reason: "short with a pointer",
    }));
    const input = {
      result: "long document",
      message: "Short summary, file on RAK-1.",
    };
    const grade = await gradeRelay(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(`${TICKET_RUBRIC_VERSION}/relay`);
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("pass");
  });

  it("asks the review judge to compare the verdict with the real contents", async () => {
    const judge = vi.fn(async () => ({ pass: false, reason: "rubber stamp" }));
    const example = REVIEW_EXAMPLES.find((e) => e.id === "rubber-stamp")!;
    const { id: _id, expected: _expected, ...input } = example;
    const grade = await gradeReviewVerdict(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain("not from the summary");
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("fail");
  });

  it("asks the delegation judge to fit the way work is handed over to its size", async () => {
    const judge = vi.fn(async () => ({
      pass: false,
      reason: "big job sent as a message",
    }));
    const example = DELEGATION_EXAMPLES.find((e) => e.id === "big-collection-as-message")!;
    const { id: _id, expected: _expected, ...input } = example;
    const grade = await gradeDelegation(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(`${TICKET_RUBRIC_VERSION}/delegation`);
    expect(call.rubric).toContain("acceptance criteria");
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("fail");
  });

  it("asks the granularity judge for one ticket per deliverable, with the items inside it", async () => {
    const judge = vi.fn(async () => ({ pass: false, reason: "a ticket per lead" }));
    const example = GRANULARITY_EXAMPLES.find((e) => e.id === "ticket-per-lead")!;
    const { id: _id, expected: _expected, ...input } = example;
    const grade = await gradeTicketGranularity(input, { judge, signal });
    const call = (judge.mock.calls[0] as unknown as [{ rubric: string; evidence: unknown }])[0];
    expect(call.rubric).toContain(`${TICKET_RUBRIC_VERSION}/granularity`);
    expect(call.rubric).toContain("one ticket per deliverable");
    expect(call.evidence).toEqual(input);
    expect(grade.status).toBe("fail");
  });

  it("takes a judge error as unqualified, never a pass", async () => {
    const judge = async () => {
      throw new Error("timeout");
    };
    expect((await gradeRelay({ result: "x", message: "y" }, { judge, signal })).status).toBe(
      "unqualified",
    );
    expect(
      (await gradeTicketGranularity({ goal: "x", tickets: "y" }, { judge, signal })).status,
    ).toBe("unqualified");
  });
});
