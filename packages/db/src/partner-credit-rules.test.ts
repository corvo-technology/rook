import type { PartnerPricingConfig } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  creditLimitReached,
  creditPeriod,
  creditPeriodEnd,
  fundBelowThreshold,
  fundIsLow,
  modelAllowed,
  resourceCredits,
  resourceHoldId,
  splitFund,
  topupBackoffMinutes,
} from "./partner-credit-rules.js";

// Test numbers only: the real ones are written by a platform admin as a versioned config.
const CONFIG: PartnerPricingConfig = {
  tiers: [],
  costs: {
    models: {},
    voiceMinuteMicros: 20_000,
    computerMinuteMicros: 1_000,
    storageGbMonthMicros: 50_000,
  },
  margins: {
    tokensBps: 2000,
    perModelBps: {},
    voiceBps: 3000,
    computerMinuteBps: 1000,
    storageBps: 1000,
  },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

const CREDIT = 10_000n;

describe("allowed models", () => {
  it("allows everything when the list is empty", () => {
    expect(modelAllowed([], "p", "m")).toBe(true);
  });
  it("matches the model id or provider/model, and nothing else", () => {
    expect(modelAllowed(["m1"], "p", "m1")).toBe(true);
    expect(modelAllowed(["p/m1"], "p", "m1")).toBe(true);
    expect(modelAllowed(["m1"], "p", "m2")).toBe(false);
    expect(modelAllowed(["q/m1"], "p", "m1")).toBe(false);
  });
});

describe("customer credit limit", () => {
  it("blocks at the limit, not below it, and never without one", () => {
    expect(creditLimitReached(99n * CREDIT, 100)).toBe(false);
    expect(creditLimitReached(100n * CREDIT, 100)).toBe(true);
    expect(creditLimitReached(10_000n * CREDIT, null)).toBe(false);
  });
});

describe("fund thresholds", () => {
  it("is low only under the share of what the fund was filled with", () => {
    expect(fundIsLow(200n * CREDIT, 1000n * CREDIT, 2000)).toBe(false);
    expect(fundIsLow(199n * CREDIT, 1000n * CREDIT, 2000)).toBe(true);
    expect(fundIsLow(0n, 0n, 2000)).toBe(false);
  });
  it("triggers auto top-up strictly under the threshold", () => {
    expect(fundBelowThreshold(500n * CREDIT, 500)).toBe(false);
    expect(fundBelowThreshold(499n * CREDIT, 500)).toBe(true);
  });
  it("backs off 15 minutes, doubling, to at most a day", () => {
    expect([1, 2, 3, 20].map(topupBackoffMinutes)).toEqual([15, 30, 60, 1440]);
  });
});

describe("resource split", () => {
  it("prices voice, computer and storage from the published rates, rounding credits up", () => {
    // 10 voice minutes: 200,000 micros + 30% = 260,000 = 26 credits.
    expect(resourceCredits(CONFIG, "voice", 10)).toBe(26);
    // 100 computer minutes: 100,000 + 10% = 110,000 = 11 credits.
    expect(resourceCredits(CONFIG, "computer", 100)).toBe(11);
    // 1 minute: 1,000 + 10% = 1,100 micros, still one whole credit.
    expect(resourceCredits(CONFIG, "computer", 1)).toBe(1);
  });
  it("charges storage only above the allowance", () => {
    expect(resourceCredits(CONFIG, "storage", 5)).toBe(0);
    // 3 GB over: 150,000 + 10% = 165,000 = 17 credits (16.5 rounded up).
    expect(resourceCredits(CONFIG, "storage", 8)).toBe(17);
  });
  it("charges nothing for no use", () => {
    expect(resourceCredits(CONFIG, "voice", 0)).toBe(0);
    expect(resourceCredits(CONFIG, "voice", Number.NaN)).toBe(0);
  });
  it("names a debit so the usage split finds it by its ledger source", () => {
    expect(`hold:${resourceHoldId("computer", "org-1", "run-1")}`).toMatch(
      /^hold:resource:computer:/,
    );
  });
});

describe("plan credits and top-ups", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  const lots = [
    {
      source: "purchase:partner-plan:p1:2026-11",
      availableMicros: 300n * CREDIT,
      expiresAt: creditPeriodEnd(now),
    },
    {
      source: "purchase:partner-plan:p1:2026-10",
      availableMicros: 90n * CREDIT,
      expiresAt: new Date("2026-11-01T00:00:00Z"),
    },
    { source: "purchase:topup-1", availableMicros: 500n * CREDIT, expiresAt: null },
  ];
  it("counts the plan credits of the period and the top-ups that never expire", () => {
    expect(splitFund(lots, now)).toEqual({ planMicros: 300n * CREDIT, topupMicros: 500n * CREDIT });
  });
  it("lets the plan credits go at the period end while the top-up stays", () => {
    const later = new Date("2026-12-01T00:00:00Z");
    expect(splitFund(lots, later)).toEqual({ planMicros: 0n, topupMicros: 500n * CREDIT });
  });
  it("names periods in UTC", () => {
    expect(creditPeriod(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12");
    expect(creditPeriodEnd(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});
