import { describe, expect, it } from "vitest";
import {
  AI_USE_CENTS,
  aiAddOnPriceCents,
  currencyForLocale,
  extraPersonCents,
  planPriceCents,
} from "./index.js";

describe("plan pricing", () => {
  it("prices each plan in cents per currency", () => {
    expect(planPriceCents("personal", "usd", "month")).toBe(1500);
    expect(planPriceCents("team", "usd", "month")).toBe(3900);
    expect(planPriceCents("company", "usd", "month")).toBe(8900);
    expect(planPriceCents("personal", "brl", "month")).toBe(8990);
    expect(planPriceCents("team", "brl", "month")).toBe(23590);
    expect(planPriceCents("company", "brl", "month")).toBe(53790);
  });

  it("charges ten months for a year", () => {
    expect(planPriceCents("company", "usd", "year")).toBe(89000);
    expect(planPriceCents("team", "brl", "year")).toBe(235900);
  });

  it("prices an extra person", () => {
    expect(extraPersonCents("usd", "month")).toBe(300);
    expect(extraPersonCents("brl", "month")).toBe(1900);
    expect(extraPersonCents("brl", "year")).toBe(19000);
  });

  it("prices the AI add-on above the use it buys, with no yearly discount", () => {
    expect(AI_USE_CENTS).toEqual([1000, 2000, 5000, 10000]);
    expect(aiAddOnPriceCents("usd", 1000, "month")).toBe(1200);
    expect(aiAddOnPriceCents("usd", 10000, "month")).toBe(12000);
    expect(aiAddOnPriceCents("brl", 1000, "month")).toBe(7190);
    expect(aiAddOnPriceCents("brl", 10000, "month")).toBe(72590);
    expect(aiAddOnPriceCents("usd", 1000, "year")).toBe(14400);
    expect(aiAddOnPriceCents("brl", 1000, "year")).toBe(86280);
  });

  it("chooses reais only for Brazilian Portuguese", () => {
    expect(currencyForLocale("pt-BR")).toBe("brl");
    expect(currencyForLocale("pt-br")).toBe("brl");
    expect(currencyForLocale("en")).toBe("usd");
    expect(currencyForLocale("pt-PT")).toBe("usd");
    expect(currencyForLocale("")).toBe("usd");
  });
});
