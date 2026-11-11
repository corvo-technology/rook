import { describe, expect, it } from "vitest";
import {
  addReplyUsage,
  createReplyBudget,
  REPLY_CAP_TOOL_REFUSAL,
  refuseToolAtCap,
} from "./reply-budget.js";

describe("reply budget", () => {
  it("caps a reply at a tenth of the monthly limit", () => {
    const budget = createReplyBudget(1_000_000, 0);
    expect(budget.cap).toBe(100_000);
    addReplyUsage(budget, 100_000);
    expect(budget.over).toBe(false);
    addReplyUsage(budget, 1);
    expect(budget.over).toBe(true);
    expect(budget.cut).toBe(false);
  });

  it("cuts a reply past 1.3 times its cap", () => {
    const budget = createReplyBudget(1_000_000, 0);
    addReplyUsage(budget, 130_001);
    expect(budget.cut).toBe(true);
  });

  it("refuses tools only past the cap and cuts on the fourth refusal", () => {
    const budget = createReplyBudget(1_000_000, 0);
    expect(refuseToolAtCap(budget)).toBeNull();
    addReplyUsage(budget, 100_001);
    for (let call = 0; call < 3; call += 1) {
      expect(refuseToolAtCap(budget)).toEqual({ error: REPLY_CAP_TOOL_REFUSAL });
      expect(budget.cut).toBe(false);
    }
    expect(refuseToolAtCap(budget)).toEqual({ error: REPLY_CAP_TOOL_REFUSAL });
    expect(budget.cut).toBe(true);
  });

  it("uses the fixed base without a limit", () => {
    const budget = createReplyBudget(null, 4_999_999);
    expect(budget.over).toBe(false);
    addReplyUsage(budget, 2);
    expect(budget.over).toBe(true);
  });

  it("starts over when an earlier attempt already passed the cap", () => {
    expect(createReplyBudget(1_000_000, 100_001).over).toBe(true);
  });
});
