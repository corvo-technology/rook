import type { AiUseCents, BillingCurrency, BillingInterval } from "./plan-pricing.js";
import type { PlanId } from "./plans.js";

/** Lookup keys that find a catalog price in the billing provider, whatever its id. */
export function planLookupKey(
  plan: PlanId,
  currency: BillingCurrency,
  interval: BillingInterval,
): string {
  return `plan_${plan}_${currency}_${interval}`;
}

export function extraPersonLookupKey(currency: BillingCurrency, interval: BillingInterval): string {
  return `extra_person_${currency}_${interval}`;
}

export function aiLookupKey(
  useCents: AiUseCents,
  currency: BillingCurrency,
  interval: BillingInterval,
): string {
  return `ai_${useCents}_${currency}_${interval}`;
}
