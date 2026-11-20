import type { AiUseCents, BillingCurrency, BillingInterval } from "./plan-pricing.js";
import { AI_USE_CENTS } from "./plan-pricing.js";
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

/** The monthly AI amount an AI price's lookup key names; null for any other key. */
export function parseAiLookupKey(key: string | null | undefined): AiUseCents | null {
  const match = /^ai_(\d+)_(usd|brl)_(month|year)$/.exec(key ?? "");
  const cents = Number(match?.[1]);
  return (AI_USE_CENTS as readonly number[]).includes(cents) ? (cents as AiUseCents) : null;
}
