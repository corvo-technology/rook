import { PlanIdSchema } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { BillingEmulator } from "./billing-emulator.js";
import { ensurePlanPriceSetup } from "./plan-price-setup.js";

describe("plan price setup", () => {
  it("creates every price the first time and none the second, with the same output", async () => {
    const provider = new BillingEmulator();
    const first = await ensurePlanPriceSetup(provider);
    expect(Object.keys(first.ids)).toHaveLength(32);
    expect(provider.catalogPrices.size).toBe(32);
    const second = await ensurePlanPriceSetup(provider);
    expect(provider.catalogPrices.size).toBe(32);
    expect(second).toEqual(first);
  });

  it("maps only the twelve plan prices to their plans, for PLAN_PRICES", async () => {
    const { planPrices } = await ensurePlanPriceSetup(new BillingEmulator());
    expect(Object.keys(planPrices)).toHaveLength(12);
    expect(planPrices.price_plan_team_brl_year).toBe("team");
    for (const plan of Object.values(planPrices))
      expect(PlanIdSchema.safeParse(plan).success).toBe(true);
    expect(planPrices.price_extra_person_brl_year).toBeUndefined();
  });

  it("refuses a provider that cannot create plan prices", async () => {
    await expect(ensurePlanPriceSetup({} as never)).rejects.toThrow(/plan prices/);
  });
});
