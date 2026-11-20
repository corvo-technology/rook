import type { BillingProvider } from "@corvo/adapter-kit";
import type { PlanId } from "@corvo/contracts";
import { parsePlanLookupKey } from "@corvo/contracts";

/**
 * Creates the catalog prices that are missing and reports what the API needs: the `PLAN_PRICES`
 * mapping from each plan price id to its plan. Safe to run again; a second run creates nothing.
 */
export async function ensurePlanPriceSetup(
  provider: Pick<BillingProvider, "ensurePlanPrices">,
): Promise<{ ids: Record<string, string>; planPrices: Record<string, PlanId> }> {
  if (!provider.ensurePlanPrices) throw new Error("This billing provider has no plan prices");
  const ids = await provider.ensurePlanPrices();
  const planPrices: Record<string, PlanId> = {};
  for (const [key, id] of Object.entries(ids)) {
    const plan = parsePlanLookupKey(key)?.plan;
    if (plan) planPrices[id] = plan;
  }
  return { ids, planPrices };
}
