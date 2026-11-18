import { describe, expect, it } from "vitest";
import {
  currentPeriod,
  finalMinor,
  formatMoney,
  markupMinor,
  minorText,
  newIdempotencyKey,
  parseMinor,
  partnerPath,
  previousPeriod,
  sectionsFor,
} from "./partner-console";

describe("partner console helpers", () => {
  it("gives embedded partners credits and invoices, and the others prices and revenue", () => {
    expect(sectionsFor("embedded")).toEqual([
      "overview",
      "customers",
      "template",
      "credits",
      "invoices",
      "integration",
    ]);
    expect(sectionsFor("white_label")).toEqual([
      "overview",
      "customers",
      "template",
      "pricing",
      "revenue",
      "integration",
    ]);
  });

  it("builds an address that survives odd ids", () => {
    expect(partnerPath("a/b", "customers")).toBe("/app/partner/a%2Fb/customers");
  });

  it("prices a fixed and a percent markup on top of the base", () => {
    expect(finalMinor(10_000, { kind: "fixed", value: 3_000 })).toBe(13_000);
    expect(finalMinor(10_000, { kind: "percent", value: 2_500 })).toBe(12_500);
    expect(finalMinor(10_000, { kind: "percent", value: 0 })).toBe(10_000);
    expect(markupMinor(333, { kind: "percent", value: 1_000 })).toBe(33);
  });

  it("reads typed amounts in either decimal style", () => {
    expect(parseMinor("12,50")).toBe(1250);
    expect(parseMinor("12.5")).toBe(1250);
    expect(parseMinor("15")).toBe(1500);
    expect(parseMinor("")).toBeNull();
    expect(parseMinor("abc")).toBeNull();
    expect(parseMinor("-1")).toBeNull();
    expect(minorText(1250)).toBe("12.5");
    expect(minorText(0)).toBe("");
  });

  it("formats money in the partner's currency", () => {
    expect(formatMoney(784_000, "BRL", "pt-BR").replace(/\s/g, " ")).toBe("R$ 7.840,00");
  });

  it("walks back through months across a year", () => {
    expect(currentPeriod(new Date("2026-11-18T10:00:00Z"))).toBe("2026-11");
    expect(previousPeriod("2026-02", 3)).toBe("2025-11");
  });

  it("makes a different idempotency key for each intent", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[\x21-\x7e]{8,128}$/);
    expect(newIdempotencyKey()).not.toBe(key);
  });
});
