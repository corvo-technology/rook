import { describe, expect, it } from "vitest";
import {
  PartnerConsoleActionInput,
  PartnerConsoleCustomersInput,
  PartnerConsoleSetPricingInput,
} from "./partner-console.js";

describe("partner console inputs", () => {
  it("refuses to set what Rook decides: commission, mode, country and currency", () => {
    for (const field of ["commissionBps", "mode", "country", "currency"]) {
      const parsed = PartnerConsoleSetPricingInput.safeParse({
        partnerId: "p1",
        markups: [],
        [field]: field === "commissionBps" ? 0 : "x",
      });
      expect(parsed.success).toBe(false);
    }
    expect(
      PartnerConsoleSetPricingInput.safeParse({
        partnerId: "p1",
        markups: [{ itemId: "plan:team", kind: "percent", value: 1500 }],
      }).success,
    ).toBe(true);
  });

  it("takes an amount with add_credit only, and a usable idempotency key", () => {
    const base = { partnerId: "p1", tenantId: "t1", idempotencyKey: "abcdefgh" };
    expect(
      PartnerConsoleActionInput.safeParse({ ...base, action: "add_credit", amountMinor: 500 })
        .success,
    ).toBe(true);
    expect(PartnerConsoleActionInput.safeParse({ ...base, action: "add_credit" }).success).toBe(
      false,
    );
    expect(
      PartnerConsoleActionInput.safeParse({ ...base, action: "pause", amountMinor: 500 }).success,
    ).toBe(false);
    expect(PartnerConsoleActionInput.safeParse({ ...base, action: "pause" }).success).toBe(true);
    expect(
      PartnerConsoleActionInput.safeParse({ ...base, action: "pause", idempotencyKey: "short" })
        .success,
    ).toBe(false);
    expect(
      PartnerConsoleActionInput.safeParse({ ...base, action: "add_credit", amountMinor: 0 })
        .success,
    ).toBe(false);
  });

  it("defaults the customer filter and page size", () => {
    expect(PartnerConsoleCustomersInput.parse({ partnerId: "p1" })).toMatchObject({
      filter: "all",
      limit: 25,
    });
  });
});
