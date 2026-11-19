import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANS,
  GIB,
  parsePlanLookupKey,
  planConfigFromEnv,
  resolveEntitlements,
  storageLevel,
} from "./plans.js";

const config = planConfigFromEnv({
  PLAN_PRICES: '{"price_team":"team","price_company":"company"}',
})!;

describe("plan configuration", () => {
  it("has no plans, so no limits, unless the deployment maps prices", () => {
    expect(planConfigFromEnv({})).toBeUndefined();
    expect(planConfigFromEnv({ PLAN_PRICES: "  " })).toBeUndefined();
    expect(resolveEntitlements(undefined, { status: "active", priceId: "price_team" })).toBeNull();
  });

  it("starts from the default table and lets PLAN_LIMITS edit it", () => {
    expect(config.plans).toEqual(DEFAULT_PLANS);
    expect(DEFAULT_PLANS.team).toMatchObject({
      computerSize: "medium",
      computers: 1,
      storageBytes: 50 * GIB,
      seatsIncluded: 10,
      maxSeats: 15,
    });
    const edited = planConfigFromEnv({
      PLAN_PRICES: "{}",
      PLAN_LIMITS: '{"team":{"computers":5,"storageGb":150,"computerSize":"large"}}',
    })!;
    expect(edited.plans.team).toMatchObject({
      computers: 5,
      storageBytes: 150 * GIB,
      computerSize: "large",
      seatsIncluded: 10,
    });
    expect(edited.plans.personal).toEqual(DEFAULT_PLANS.personal);
  });

  it("rejects a malformed mapping instead of silently running unlimited", () => {
    expect(() => planConfigFromEnv({ PLAN_PRICES: "not json" })).toThrow(
      "PLAN_PRICES must be JSON",
    );
    expect(() => planConfigFromEnv({ PLAN_PRICES: '{"price_x":"gold"}' })).toThrow();
    expect(() =>
      planConfigFromEnv({ PLAN_PRICES: "{}", PLAN_LIMITS: '{"team":{"computers":0}}' }),
    ).toThrow();
  });
});

describe("plan resolution", () => {
  const plan = (status: string | null, priceId: string | null) =>
    resolveEntitlements(config, { status, priceId })?.plan;

  it("maps a paid subscription's price to its plan", () => {
    expect(plan("active", "price_team")).toBe("team");
    expect(plan("past_due", "price_company")).toBe("company");
  });

  it("gives personal to no plan, a trial, an unmapped price, or an ended subscription", () => {
    expect(resolveEntitlements(config, null)?.plan).toBe("personal");
    expect(plan(null, null)).toBe("personal");
    expect(plan("trialing", "price_team")).toBe("personal");
    expect(plan("active", "price_unknown")).toBe("personal");
    expect(plan("active", null)).toBe("personal");
    expect(plan("canceled", "price_company")).toBe("personal");
    expect(plan("unpaid", "price_company")).toBe("personal");
  });
});

describe("seat defaults and overrides", () => {
  it("includes one person on personal and allows extras on team and company up to a max", () => {
    expect(DEFAULT_PLANS.personal).toMatchObject({ seatsIncluded: 1, maxSeats: 1 });
    expect(DEFAULT_PLANS.team).toMatchObject({ seatsIncluded: 10, maxSeats: 15 });
    expect(DEFAULT_PLANS.company).toMatchObject({ seatsIncluded: 25, maxSeats: 50 });
  });

  it("takes the extra seat price and seat limits from configuration", () => {
    const edited = planConfigFromEnv({
      PLAN_PRICES: "{}",
      PLAN_LIMITS: '{"team":{"extraSeatPriceId":"price_seat","maxSeats":12}}',
    })!;
    expect(edited.plans.team).toMatchObject({ extraSeatPriceId: "price_seat", maxSeats: 12 });
    expect(edited.plans.personal.extraSeatPriceId).toBeUndefined();
  });

  it("applies an override over the plan's value and leaves the rest", () => {
    const billing = { status: "active", priceId: "price_team" };
    const custom = resolveEntitlements(config, billing, {
      computers: 8,
      maxSeats: 40,
      storageGb: 250,
    });
    expect(custom).toMatchObject({
      plan: "team",
      computers: 8,
      maxSeats: 40,
      storageBytes: 250 * GIB,
      computerSize: "medium",
      seatsIncluded: 10,
    });
    expect(resolveEntitlements(config, billing, null)).toEqual(DEFAULT_PLANS.team);
    expect(resolveEntitlements(config, null, { computerSize: "large" })?.computerSize).toBe(
      "large",
    );
    expect(resolveEntitlements(undefined, billing, { computers: 8 })).toBeNull();
  });
});

describe("storage level", () => {
  it("is near from 80% and full at 100%", () => {
    expect(storageLevel(79, 100)).toBe("ok");
    expect(storageLevel(80, 100)).toBe("near");
    expect(storageLevel(99, 100)).toBe("near");
    expect(storageLevel(100, 100)).toBe("full");
    expect(storageLevel(130, 100)).toBe("full");
  });
});

describe("plan price lookup keys", () => {
  it("names the plan, currency and interval of a catalog plan price", () => {
    expect(parsePlanLookupKey("plan_team_brl_year")).toEqual({
      plan: "team",
      currency: "brl",
      interval: "year",
    });
    expect(parsePlanLookupKey("plan_gold_brl_year")).toBeNull();
    expect(parsePlanLookupKey("extra_person_brl_year")).toBeNull();
    expect(parsePlanLookupKey(null)).toBeNull();
  });

  it("resolves a price missing from PLAN_PRICES by its lookup key, only while paid", () => {
    const hand = {
      status: "active",
      priceId: "price_unlisted",
      priceLookupKey: "plan_company_usd_month",
    };
    expect(resolveEntitlements(config, hand)?.plan).toBe("company");
    expect(resolveEntitlements(config, { ...hand, status: "canceled" })?.plan).toBe("personal");
    expect(
      resolveEntitlements(config, { status: "active", priceId: "price_team", priceLookupKey: null })
        ?.plan,
    ).toBe("team");
    expect(resolveEntitlements(config, { status: "active", priceId: "price_unlisted" })?.plan).toBe(
      "personal",
    );
  });
});
