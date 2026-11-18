import { describe, expect, it } from "vitest";
import {
  markupError,
  markupItemId,
  markupMinor,
  parseMarkupItemId,
  priceItem,
  subscriptionPriceMinor,
} from "./partner-markup.js";

describe("markup math", () => {
  it("adds a fixed markup as it is and a percent markup rounded down", () => {
    expect(markupMinor(49900, { kind: "fixed", value: 700 })).toBe(700);
    expect(markupMinor(49900, { kind: "percent", value: 1500 })).toBe(7485);
    // 2900 cents at 3.33% is 96.57 cents: a customer is never charged a fraction.
    expect(markupMinor(2900, { kind: "percent", value: 333 })).toBe(96);
    expect(markupMinor(1, { kind: "percent", value: 9999 })).toBe(0);
    expect(markupMinor(100, null)).toBe(0);
    expect(markupMinor(100, { kind: "fixed", value: 0 })).toBe(0);
  });

  it("prices BRL and USD alike: base, the partner's commission inside it, the markup on top", () => {
    expect(priceItem(49900, 2000, { kind: "percent", value: 1500 })).toEqual({
      baseMinor: 49900,
      commissionMinor: 9980,
      markupMinor: 7485,
      finalMinor: 57385,
    });
    expect(priceItem(2900, 2000, { kind: "fixed", value: 100 })).toEqual({
      baseMinor: 2900,
      commissionMinor: 580,
      markupMinor: 100,
      finalMinor: 3000,
    });
    // Rook's share rounds down, so the commission takes the odd cent and the two sum to the base.
    expect(priceItem(999, 2000).commissionMinor).toBe(999 - Math.floor((999 * 8000) / 10000));
    expect(priceItem(100, 0).commissionMinor).toBe(0);
  });

  it("caps a markup at 100% of the base", () => {
    expect(markupError(2900, { kind: "fixed", value: 2900 })).toBeNull();
    expect(markupError(2900, { kind: "fixed", value: 2901 })).toBe("cap");
    expect(markupError(2900, { kind: "percent", value: 10_000 })).toBeNull();
    expect(markupError(2900, { kind: "percent", value: 10_001 })).toBe("cap");
    expect(markupError(2900, { kind: "fixed", value: -1 })).toBe("value");
    expect(markupError(2900, { kind: "fixed", value: 1.5 })).toBe("value");
    expect(markupError(2900, { kind: "weird" as never, value: 1 })).toBe("kind");
  });

  it("names a plan or a pack by kind and key", () => {
    expect(markupItemId("plan", "team")).toBe("plan:team");
    expect(parseMarkupItemId("pack:pack_s")).toEqual({ itemKind: "pack", itemKey: "pack_s" });
    expect(parseMarkupItemId("team")).toBeNull();
    expect(parseMarkupItemId("plan:Bad Key")).toBeNull();
  });
});

describe("the snapshot rule", () => {
  const sold = { baseMinor: 49900, markupMinor: 2000, periodEnd: new Date("2026-12-01T00:00:00Z") };

  it("keeps the price a subscription was sold at until its period ends", () => {
    expect(subscriptionPriceMinor(sold, 60000, new Date("2026-11-30T23:59:59Z"))).toBe(51900);
  });

  it("uses the current price from the moment it renews", () => {
    expect(subscriptionPriceMinor(sold, 60000, new Date("2026-12-01T00:00:00Z"))).toBe(60000);
    expect(subscriptionPriceMinor(sold, 49900, new Date("2027-01-15T00:00:00Z"))).toBe(49900);
  });
});
