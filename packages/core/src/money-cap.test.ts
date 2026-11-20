import { describe, expect, it } from "vitest";
import { callAmount, moneyCapVerdict, toolMovesMoney } from "./money-cap.js";

describe("toolMovesMoney", () => {
  it("marks charge, pay, transfer, refund and payout tools in any name style", () => {
    for (const name of [
      "create_charge",
      "payInvoice",
      "transfer_funds",
      "refund-payment",
      "createPayout",
      "mcp__stripe__create_payment",
    ]) {
      expect(toolMovesMoney(name, "high")).toBe(true);
    }
  });

  it("does not mark reads or unrelated tools", () => {
    expect(toolMovesMoney("get_charge", "read")).toBe(false);
    expect(toolMovesMoney("list_payments", "read")).toBe(false);
    expect(toolMovesMoney("create_task", "low")).toBe(false);
  });
});

describe("callAmount", () => {
  it("reads an amount as written and cents or minor units divided by 100", () => {
    expect(callAmount({ amount: 25 })).toBe(25);
    expect(callAmount({ amount: "12.50" })).toBe(12.5);
    expect(callAmount({ amount_cents: 2500 })).toBe(25);
    expect(callAmount({ unit_amount: 1000 })).toBe(10);
    expect(callAmount({ payment: { amount: 40 } })).toBe(40);
  });

  it("takes the largest of several amounts and the size of a negative one", () => {
    expect(callAmount({ amount: 5, total: 90 })).toBe(90);
    expect(callAmount({ amount: -30 })).toBe(30);
  });

  it("is null when no amount is given or one cannot be read", () => {
    expect(callAmount({ to: "acct" })).toBeNull();
    expect(callAmount({ amount: "ten" })).toBeNull();
    expect(callAmount({ amount: { nested: 1 } })).toBeNull();
    expect(callAmount({ amount: 5, total: "lots" })).toBeNull();
    expect(callAmount("25")).toBeNull();
  });
});

describe("moneyCapVerdict", () => {
  const cap = { perCall: 50, perMonth: 200 };

  it("lets a call within both limits run", () => {
    expect(moneyCapVerdict({ cap, amount: 50, spentThisMonth: 150 })).toBe("within");
  });

  it("asks over the per-call limit and over the month", () => {
    expect(moneyCapVerdict({ cap, amount: 50.01, spentThisMonth: 0 })).toBe("over");
    expect(moneyCapVerdict({ cap, amount: 30, spentThisMonth: 171 })).toBe("over");
  });

  it("asks when a capped call has no readable amount", () => {
    expect(moneyCapVerdict({ cap, amount: null, spentThisMonth: 0 })).toBe("unreadable");
    expect(
      moneyCapVerdict({ cap: { perCall: null, perMonth: 10 }, amount: null, spentThisMonth: 0 }),
    ).toBe("unreadable");
  });

  it("applies nothing without a limit", () => {
    expect(
      moneyCapVerdict({ cap: { perCall: null, perMonth: null }, amount: null, spentThisMonth: 0 }),
    ).toBe("within");
    expect(
      moneyCapVerdict({ cap: { perCall: null, perMonth: 100 }, amount: 1e9, spentThisMonth: 0 }),
    ).toBe("over");
  });
});
