import { describe, expect, it } from "vitest";
import {
  addMonthsUtc,
  creditMicros,
  minorOfMicros,
  parseRateE8,
  periodDays,
  prorate,
  remainingPeriodDays,
  reversedTarget,
  splitRevenue,
  stateAllowsAccess,
  subscriptionState,
} from "./commerce-money.js";

describe("revenue split rounding", () => {
  // base, commission in bps, paid, then the expected Rook share, commission and markup.
  it.each([
    [100, 2000, 130, 80, 20, 30],
    [100, 2000, 100, 80, 20, 0],
    [100, 2000, 70, 80, 20, 0],
    [49900, 2000, 54900, 39920, 9980, 5000],
    [99, 2000, 99, 79, 20, 0],
    [1, 2000, 1, 0, 1, 0],
    [3, 3333, 3, 2, 1, 0],
    [999, 1250, 999, 874, 125, 0],
    [100, 0, 100, 100, 0, 0],
    [100, 10000, 100, 0, 100, 0],
    [0, 2000, 0, 0, 0, 0],
  ])(
    "base %i at %i bps paid %i gives Rook %i, commission %i, markup %i",
    (base, bps, paid, rook, commission, markup) => {
      const split = splitRevenue(base, bps, paid);
      expect(split).toEqual({
        baseMinor: base,
        rookShareMinor: rook,
        partnerCommissionMinor: commission,
        markupMinor: markup,
      });
      // Rook's share and the commission add up to the base exactly, always.
      expect(split.rookShareMinor + split.partnerCommissionMinor).toBe(base);
    },
  );

  it("keeps the sum exact for every base up to a thousand at awkward rates", () => {
    for (const bps of [1, 333, 1250, 2000, 3333, 9999]) {
      for (let base = 0; base <= 1000; base++) {
        const split = splitRevenue(base, bps);
        expect(split.rookShareMinor + split.partnerCommissionMinor).toBe(base);
        expect(split.rookShareMinor).toBe(Math.floor((base * (10_000 - bps)) / 10_000));
      }
    }
  });

  it("never lets a discount lower Rook's share", () => {
    expect(splitRevenue(10_000, 2000, 5_000).rookShareMinor).toBe(8000);
  });

  it("handles amounts whose product would overflow a double", () => {
    expect(splitRevenue(2_000_000_000, 2000).rookShareMinor).toBe(1_600_000_000);
  });

  it("refuses nonsense", () => {
    expect(() => splitRevenue(-1, 2000)).toThrow();
    expect(() => splitRevenue(1.5, 2000)).toThrow();
    expect(() => splitRevenue(100, 10_001)).toThrow();
  });
});

describe("proration", () => {
  it("rounds down per line and counts the day of the change for the new plan", () => {
    const start = new Date("2026-11-01T00:00:00Z");
    const end = new Date("2026-12-01T00:00:00Z");
    expect(periodDays(start, end)).toBe(30);
    expect(remainingPeriodDays(new Date("2026-11-21T15:30:00Z"), end)).toBe(10);
    expect(remainingPeriodDays(new Date("2026-11-01T00:00:00Z"), end)).toBe(30);
    expect(prorate(15000, 10, 30)).toBe(5000);
    expect(prorate(100, 1, 30)).toBe(3);
    expect(prorate(100, 40, 30)).toBe(100);
    expect(prorate(100, 5, 0)).toBe(0);
  });
});

describe("partial refunds", () => {
  it("reverse exactly the original, whatever the split", () => {
    for (const paid of [100, 130, 5500, 999]) {
      for (const total of [0, 1, 79, 80, 3333]) {
        let before = 0;
        let reversed = 0;
        for (const part of [Math.floor(paid / 3), Math.floor(paid / 3) + 1]) {
          const cumulative = before + part;
          reversed += reversedTarget(total, cumulative, paid) - reversedTarget(total, before, paid);
          before = cumulative;
        }
        reversed += reversedTarget(total, paid, paid) - reversedTarget(total, before, paid);
        expect(reversed).toBe(total);
      }
    }
  });
});

describe("FX conversion", () => {
  it("is exact in USD and rounds down in BRL with the spread taken off", () => {
    expect(creditMicros({ currency: "USD", creditMinor: 4000 })).toBe(40_000_000n);
    const rate = parseRateE8("5.12");
    expect(rate).toBe(512_000_000n);
    // R$ 200 at 5.12 is US$ 39.0625 before the spread.
    expect(creditMicros({ currency: "BRL", creditMinor: 20_000, rateE8: rate, spreadBps: 0 })).toBe(
      39_062_500n,
    );
    // A 3% spread leaves 97% of it, rounded down.
    expect(
      creditMicros({ currency: "BRL", creditMinor: 20_000, rateE8: rate, spreadBps: 300 }),
    ).toBe(37_890_625n);
    expect(
      creditMicros({ currency: "BRL", creditMinor: 1, rateE8: parseRateE8("3"), spreadBps: 300 }),
    ).toBe(3233n);
  });

  it("parses decimal rates without floats and refuses junk", () => {
    expect(parseRateE8("5")).toBe(500_000_000n);
    expect(parseRateE8("0.12345678")).toBe(12_345_678n);
    expect(parseRateE8("5.123456789")).toBe(512_345_678n);
    expect(() => parseRateE8("abc")).toThrow();
    expect(() => parseRateE8("0")).toThrow();
  });

  it("reads a share of a grant in the grant's currency, rounded down", () => {
    expect(minorOfMicros(20_000, 37_890_625n, 37_890_625n)).toBe(20_000);
    expect(minorOfMicros(20_000, 37_890_625n, 1_000_000n)).toBe(527);
    expect(minorOfMicros(20_000, 0n, 5n)).toBe(0);
  });
});

describe("dates", () => {
  it("adds months in UTC and clamps to the end of a shorter month", () => {
    expect(addMonthsUtc(new Date("2026-11-20T10:00:00Z"), 12).toISOString()).toBe(
      "2027-11-20T10:00:00.000Z",
    );
    expect(addMonthsUtc(new Date("2026-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });
});

describe("what a plan allows", () => {
  const end = new Date("2026-12-01T00:00:00Z");
  const at = (iso: string) => new Date(iso);
  it("runs while active, then for the grace period, then lapses", () => {
    const sub = { status: "active", periodEnd: end, pastDueSince: null };
    expect(subscriptionState(sub, at("2026-11-30T00:00:00Z"), 7)).toBe("active");
    expect(subscriptionState(sub, at("2026-12-05T00:00:00Z"), 7)).toBe("past_due");
    expect(subscriptionState(sub, at("2026-12-09T00:00:00Z"), 7)).toBe("lapsed");
  });
  it("keeps a past-due plan for the grace period from the first report", () => {
    const sub = { status: "past_due", periodEnd: end, pastDueSince: at("2026-11-10T00:00:00Z") };
    expect(subscriptionState(sub, at("2026-11-16T23:00:00Z"), 7)).toBe("past_due");
    expect(subscriptionState(sub, at("2026-11-17T00:00:00Z"), 7)).toBe("lapsed");
  });
  it("lets a canceled plan run to the end of its period only", () => {
    const sub = { status: "canceled", periodEnd: end, pastDueSince: null };
    expect(subscriptionState(sub, at("2026-11-30T00:00:00Z"), 7)).toBe("canceled");
    expect(subscriptionState(sub, at("2026-12-01T00:00:00Z"), 7)).toBe("lapsed");
  });
  it("refuses a customer with no plan", () => {
    expect(subscriptionState(null, new Date(), 7)).toBe("none");
    expect(stateAllowsAccess("none")).toBe(false);
    expect(stateAllowsAccess("lapsed")).toBe(false);
    expect(stateAllowsAccess("past_due")).toBe(true);
  });
});
