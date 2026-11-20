import { describe, expect, it } from "vitest";
import {
  aiLookupKey,
  extraPersonLookupKey,
  parseAiLookupKey,
  planLookupKey,
} from "./plan-price-keys.js";
import { AI_USE_CENTS, BILLING_CURRENCIES, BILLING_INTERVALS } from "./plan-pricing.js";
import { PLAN_IDS, parsePlanLookupKey } from "./plans.js";

describe("catalog lookup keys", () => {
  it("builds the documented shapes", () => {
    expect(planLookupKey("team", "brl", "year")).toBe("plan_team_brl_year");
    expect(extraPersonLookupKey("usd", "month")).toBe("extra_person_usd_month");
    expect(aiLookupKey(1000, "brl", "month")).toBe("ai_1000_brl_month");
  });

  it("round-trips every plan key and never repeats a key", () => {
    const keys = new Set<string>();
    for (const plan of PLAN_IDS)
      for (const currency of BILLING_CURRENCIES)
        for (const interval of BILLING_INTERVALS) {
          const key = planLookupKey(plan, currency, interval);
          expect(parsePlanLookupKey(key)).toEqual({ plan, currency, interval });
          keys.add(key);
        }
    for (const currency of BILLING_CURRENCIES)
      for (const interval of BILLING_INTERVALS) {
        keys.add(extraPersonLookupKey(currency, interval));
        for (const cents of AI_USE_CENTS) keys.add(aiLookupKey(cents, currency, interval));
      }
    expect(keys.size).toBe(12 + 4 + 16);
  });
});

describe("parseAiLookupKey", () => {
  it("reads the monthly amount an AI price names, and nothing from other keys", () => {
    expect(parseAiLookupKey(aiLookupKey(5000, "brl", "year"))).toBe(5000);
    expect(parseAiLookupKey("ai_777_usd_month")).toBeNull();
    expect(parseAiLookupKey("plan_team_usd_month")).toBeNull();
    expect(parseAiLookupKey(null)).toBeNull();
  });
});
