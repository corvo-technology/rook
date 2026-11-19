import * as z from "zod";
import type { PlanId } from "./plans.js";
import { PlanIdSchema } from "./plans.js";

/** What each plan costs, in reais and dollars. Sizes and limits live in `plans.ts`. */
export type BillingCurrency = "usd" | "brl";
export type BillingInterval = "month" | "year";

export const BILLING_CURRENCIES = ["usd", "brl"] as const satisfies readonly BillingCurrency[];
export const BILLING_INTERVALS = ["month", "year"] as const satisfies readonly BillingInterval[];

/** A year costs ten months. */
const YEARLY_MONTHS = 10;

/** Monthly prices in cents. Reais are dollars at 6.05, rounded down to a price ending in ,90. */
const MONTHLY_PLAN_CENTS: Readonly<Record<BillingCurrency, Readonly<Record<PlanId, number>>>> = {
  usd: { personal: 1500, team: 3900, company: 8900 },
  brl: { personal: 8990, team: 23590, company: 53790 },
};

const MONTHLY_EXTRA_PERSON_CENTS: Readonly<Record<BillingCurrency, number>> = {
  usd: 300,
  brl: 1900,
};

/** Dollars of model use a person can add, in cents. */
export const AI_USE_CENTS = [1000, 2000, 5000, 10000] as const;
export type AiUseCents = (typeof AI_USE_CENTS)[number];

/** Charged per month for each amount of use; the difference over the use covers payment and provider fees. */
const MONTHLY_AI_CENTS: Readonly<Record<BillingCurrency, Readonly<Record<AiUseCents, number>>>> = {
  usd: { 1000: 1200, 2000: 2400, 5000: 6000, 10000: 12000 },
  brl: { 1000: 7190, 2000: 14490, 5000: 36290, 10000: 72590 },
};

function forInterval(monthlyCents: number, interval: BillingInterval): number {
  return interval === "year" ? monthlyCents * YEARLY_MONTHS : monthlyCents;
}

/** What one charge of the plan costs; a yearly charge is the whole year. */
export function planPriceCents(
  plan: PlanId,
  currency: BillingCurrency,
  interval: BillingInterval,
): number {
  return forInterval(MONTHLY_PLAN_CENTS[currency][plan], interval);
}

export function extraPersonCents(currency: BillingCurrency, interval: BillingInterval): number {
  return forInterval(MONTHLY_EXTRA_PERSON_CENTS[currency], interval);
}

export function aiAddOnPriceCents(
  currency: BillingCurrency,
  useCents: AiUseCents,
  interval: BillingInterval,
): number {
  return forInterval(MONTHLY_AI_CENTS[currency][useCents], interval);
}

/** Reais for Brazilian Portuguese, dollars for every other language. */
export function currencyForLocale(locale: string): BillingCurrency {
  return locale.toLowerCase() === "pt-br" ? "brl" : "usd";
}

export const BillingCurrencySchema = z.enum(BILLING_CURRENCIES);
export const BillingIntervalSchema = z.enum(BILLING_INTERVALS);
export const AiUseCentsSchema = z.union(AI_USE_CENTS.map((cents) => z.literal(cents)));

/** What an owner chooses on the plans screen; `aiUseCents: null` means they bring their own AI. */
export const PlanCheckoutInputSchema = z.object({
  plan: PlanIdSchema,
  interval: BillingIntervalSchema,
  currency: BillingCurrencySchema,
  aiUseCents: AiUseCentsSchema.nullable(),
});
export type PlanCheckoutInput = z.infer<typeof PlanCheckoutInputSchema>;
