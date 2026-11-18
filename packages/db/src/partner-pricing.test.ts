import type { PartnerPricingConfig } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { PartnerPricingError, simulatePartnerPricing } from "./partner-pricing.js";

// Test numbers only: the real ones are written by a platform admin as a versioned config.
const CONFIG: PartnerPricingConfig = {
  tiers: [],
  costs: {
    models: {
      "model-a": { inputPer1MMicros: 1_000_000, outputPer1MMicros: 5_000_000 },
      "model-b": { inputPer1MMicros: 200_000, outputPer1MMicros: 800_000 },
    },
    voiceMinuteMicros: 20_000,
    computerMinuteMicros: 1_000,
    storageGbMonthMicros: 50_000,
  },
  margins: {
    tokensBps: 2000,
    perModelBps: { "model-b": 5000 },
    voiceBps: 3000,
    computerMinuteBps: 1000,
    storageBps: 1000,
  },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

const base = { planPriceMinor: 50_000, includedCredits: 10_000, customers: 10 };

describe("pricing simulator", () => {
  it("prices one customer from cost and margin, and counts the customers the fund supports", () => {
    const result = simulatePartnerPricing(CONFIG, {
      ...base,
      usage: {
        // 1M in at 1.00 and 100k out at 5.00 = 1.50 USD of cost; +20% = 1.80.
        models: [{ model: "model-a", inputTokens: 1_000_000, outputTokens: 100_000 }],
        voiceMinutes: 10,
        computerMinutes: 0,
        storageGb: 0,
      },
    });
    // Models 1,500,000 + voice 200,000 micros of cost; charged 1,800,000 + 260,000.
    expect(result.costPerCustomer).toEqual({ modelsMicros: 1_500_000, infraMicros: 200_000 });
    expect(result.marginPerCustomerMicros).toBe(360_000);
    // 2,060,000 micros is 206 cents.
    expect(result.creditsPerCustomer).toBe(206);
    expect(result.customersSupported).toBe(48);
    expect(result.fund).toEqual({ creditsNeeded: 2060, covered: true, shortfallCredits: 0 });
    expect(result.totalMarginMicros).toBe(3_600_000);
  });

  it("uses a per-model margin over the resource default", () => {
    const result = simulatePartnerPricing(CONFIG, {
      ...base,
      usage: {
        models: [{ model: "model-b", inputTokens: 1_000_000, outputTokens: 0 }],
        voiceMinutes: 0,
        computerMinutes: 0,
        storageGb: 0,
      },
    });
    // 200,000 micros of cost at +50% is 300,000: 30 credits.
    expect(result.creditsPerCustomer).toBe(30);
    expect(result.marginPerCustomerMicros).toBe(100_000);
  });

  it("never charges a customer's own models: they cost Rook nothing", () => {
    const usage = {
      models: [
        { model: "model-a", inputTokens: 9_000_000, outputTokens: 9_000_000, own: true },
        { model: "my-local-model", inputTokens: 5_000_000, outputTokens: 0, own: true },
      ],
      voiceMinutes: 0,
      computerMinutes: 0,
      storageGb: 0,
    };
    const result = simulatePartnerPricing(CONFIG, { ...base, usage });
    expect(result.creditsPerCustomer).toBe(0);
    expect(result.costPerCustomer.modelsMicros).toBe(0);
    expect(result.customersSupported).toBeNull();
    // Computer minutes and storage above the allowance still are.
    const withInfra = simulatePartnerPricing(CONFIG, {
      ...base,
      usage: { ...usage, computerMinutes: 600, storageGb: 7 },
    });
    // 600 min x 1,000 x 1.10 = 660,000; 2 GB billable x 50,000 x 1.10 = 110,000.
    expect(withInfra.costPerCustomer).toEqual({ modelsMicros: 0, infraMicros: 700_000 });
    expect(withInfra.creditsPerCustomer).toBe(77);
  });

  it("reports the shortfall when the fund does not cover the customers, and the plan margin", () => {
    const result = simulatePartnerPricing(CONFIG, {
      ...base,
      includedCredits: 1000,
      customers: 10,
      planPriceMicros: 100_000_000,
      usage: {
        models: [{ model: "model-a", inputTokens: 1_000_000, outputTokens: 0 }],
        voiceMinutes: 0,
        computerMinutes: 0,
        storageGb: 0,
      },
    });
    // 120 credits each: 1,200 needed against 1,000 included.
    expect(result.fund).toEqual({ creditsNeeded: 1200, covered: false, shortfallCredits: 200 });
    expect(result.customersSupported).toBe(8);
    expect(result.planMarginMicros).toBe(100_000_000 - 10_000_000);
  });

  it("is deterministic and refuses a model it has no cost for", () => {
    const input = {
      ...base,
      usage: {
        models: [{ model: "model-a", inputTokens: 123_457, outputTokens: 9_999 }],
        voiceMinutes: 1.5,
        computerMinutes: 3.25,
        storageGb: 5.5,
      },
    };
    expect(simulatePartnerPricing(CONFIG, input)).toEqual(simulatePartnerPricing(CONFIG, input));
    expect(() =>
      simulatePartnerPricing(CONFIG, {
        ...base,
        usage: {
          models: [{ model: "unknown", inputTokens: 1, outputTokens: 1 }],
          voiceMinutes: 0,
          computerMinutes: 0,
          storageGb: 0,
        },
      }),
    ).toThrow(PartnerPricingError);
  });
});
