import { decideTier } from "@corvo/adapters";
import { describe, expect, it, vi } from "vitest";
import { gradeEscalation, gradeRouting, MODEL_ROUTING_CASES } from "./model-routing.js";

const signal = new AbortController().signal;
const task = MODEL_ROUTING_CASES[0]!;

describe("model routing eval", () => {
  it("keeps its task set stable and its tiers matching what the router decides", () => {
    expect(new Set(MODEL_ROUTING_CASES.map((c) => c.id)).size).toBe(MODEL_ROUTING_CASES.length);
    for (const c of MODEL_ROUTING_CASES) {
      const decision = decideTier({
        title: c.title,
        description: c.description,
        trigger: "user",
        prompt: c.prompt,
        contextTokens: 200,
        attachments: 0,
        // The approved-send case continues an action that waited for approval.
        approvalGated: c.id === "approved-send",
      });
      expect({ id: c.id, tier: decision.tier }).toEqual({ id: c.id, tier: c.expectedTier });
    }
  });

  it("passes only when the judge finds Automatic at least as good, wherever it is shown", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "same content" }));
    const grade = await gradeRouting(task, { auto: "a", strong: "b" }, false, { judge, signal });
    expect(grade.status).toBe("pass");
    expect(judge.mock.calls[0]![0].evidence).toMatchObject({
      first: "b",
      second: "a",
      candidate: "second",
    });
  });

  it("fails an empty Automatic answer without a judge", async () => {
    expect((await gradeRouting(task, { auto: " ", strong: "b" }, true)).status).toBe("fail");
  });

  it("leaves a case unqualified when there is no judge or the judge errors", async () => {
    expect((await gradeRouting(task, { auto: "a", strong: "b" }, true)).status).toBe("unqualified");
    const broken = vi.fn(async () => {
      throw new Error("provider down");
    });
    expect(
      (await gradeRouting(task, { auto: "a", strong: "b" }, true, { judge: broken, signal }))
        .status,
    ).toBe("unqualified");
  });
});

describe("escalation cases", () => {
  const hard = MODEL_ROUTING_CASES.find((c) => c.escalation === "appropriate")!;
  const easy = MODEL_ROUTING_CASES.find((c) => c.escalation === "unneeded")!;

  it("covers both an appropriate and an unneeded request for a stronger model", () => {
    expect(hard).toBeDefined();
    expect(easy).toBeDefined();
  });

  it("gives the judge the decision and the reviewed reference, never a keyword check", async () => {
    const judge = vi.fn(async () => ({ pass: true, reason: "agrees" }));
    const grade = await gradeEscalation(
      hard,
      { tier: "main", escalated: true, text: "needs a convergence proof" },
      { judge, signal },
    );
    expect(grade.status).toBe("pass");
    expect(judge.mock.calls[0]![0].evidence).toMatchObject({
      decision: "escalated",
      reference: "escalating is appropriate",
    });
    await gradeEscalation(
      easy,
      { tier: "fast", escalated: false, text: "Normal." },
      { judge, signal },
    );
    expect(judge.mock.calls[1]![0].evidence).toMatchObject({
      decision: "answered",
      reference: "escalating is not appropriate",
    });
  });

  it("leaves a case unqualified without a judge, or when it errors, and fails an empty reply", async () => {
    expect((await gradeEscalation(hard, { tier: "main", escalated: true, text: "x" })).status).toBe(
      "unqualified",
    );
    const broken = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      (
        await gradeEscalation(
          hard,
          { tier: "main", escalated: true, text: "x" },
          { judge: broken, signal },
        )
      ).status,
    ).toBe("unqualified");
    expect(
      (await gradeEscalation(hard, { tier: "main", escalated: false, text: " " })).status,
    ).toBe("fail");
  });
});
