import { describe, expect, it } from "vitest";
import { proposalSteps } from "./proposal-steps.js";

const ask = (status?: string) => ({ kind: "ask", proposal: true as const, status });

describe("proposalSteps", () => {
  it("points at the first proposal still pending", () => {
    const steps = proposalSteps([
      { kind: "text" },
      ask("answered"),
      ask("pending"),
      ask("pending"),
    ]);
    expect(steps).toEqual({ indexes: [1, 2, 3], current: 2, position: 2, total: 3 });
  });

  it("ignores asks that are not proposals", () => {
    const steps = proposalSteps([{ kind: "ask", status: "pending" }, ask("pending")]);
    expect(steps).toEqual({ indexes: [1], current: 1, position: 1, total: 1 });
  });

  it("has no current card once every proposal is answered", () => {
    const steps = proposalSteps([ask("answered"), ask("answered")]);
    expect(steps).toEqual({ indexes: [0, 1], current: null, position: 2, total: 2 });
  });
});
