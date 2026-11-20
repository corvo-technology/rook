import type { TransactionalEmail } from "@corvo/adapter-kit";
import { noticeEmail } from "@corvo/auth";
import type { AiUseCents, BillingCurrency, BillingInterval, PlanId } from "@corvo/contracts";
import {
  aiAddOnPriceCents,
  DEFAULT_PLANS,
  extraPersonCents,
  planConfigFromEnv,
  planPriceCents,
} from "@corvo/contracts";
import { BILLING_EMAIL_COPY } from "./billing-email-copy.js";
import { partnerAlertLocale } from "./partner-alert-copy.js";

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));

/** The language of the owner's app when the email system has it, English otherwise. */
export const billingEmailLocale = (locale: string | null) => partnerAlertLocale(locale, "USD");

/** People a plan's price covers: the included ones and any extra people billed above them. */
export function planPeople(plan: PlanId, total: number): number {
  return Math.max((planConfigFromEnv()?.plans ?? DEFAULT_PLANS)[plan].seatsIncluded, total);
}

/** What one charge of a plan comes to: the plan, extra people and the AI add-on. */
export function planChargeCents(input: {
  plan: PlanId;
  currency: BillingCurrency;
  interval: BillingInterval;
  people: number;
  aiUseCents: AiUseCents | null;
}): number {
  const included = (planConfigFromEnv()?.plans ?? DEFAULT_PLANS)[input.plan].seatsIncluded;
  return (
    planPriceCents(input.plan, input.currency, input.interval) +
    Math.max(0, input.people - included) * extraPersonCents(input.currency, input.interval) +
    (input.aiUseCents ? aiAddOnPriceCents(input.currency, input.aiUseCents, input.interval) : 0)
  );
}

const money = (locale: string, cents: number, currency: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

const day = (locale: string, date: Date) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);

interface NoticeContext {
  webOrigin: string;
  termsUrl: string;
}

/** Where billing is managed in the app. */
export const billingSettingsUrl = (webOrigin: string) =>
  new URL("/settings/billing", webOrigin).href;

export interface BillingConfirmation {
  to: string;
  locale: string | null;
  plan: PlanId;
  currency: BillingCurrency;
  interval: BillingInterval;
  people: number;
  /** Charged when the plan became active; null when the change was billed as a difference. */
  chargedCents: number | null;
  aiUseCents: AiUseCents | null;
  renewsAt: Date | null;
  renewalCents: number;
  /** The plan changed on a subscription that was already active. */
  changed: boolean;
}

/** What the customer keeps: the plan as it now stands, what it cost, and how to leave. */
export function billingConfirmationEmail(
  context: NoticeContext,
  input: BillingConfirmation,
): Promise<TransactionalEmail> {
  const lang = billingEmailLocale(input.locale);
  const copy = BILLING_EMAIL_COPY[lang];
  const plan = copy.plans[input.plan];
  const subject = fill(input.changed ? copy.changedSubject : copy.activeSubject, { plan });
  return noticeEmail(context.webOrigin, {
    to: input.to,
    lang,
    subject,
    title: subject,
    lines: [
      fill(copy.plan, { plan, interval: copy.interval[input.interval] }),
      fill(copy.people, { n: input.people }),
      ...(input.chargedCents === null
        ? []
        : [fill(copy.charged, { amount: money(lang, input.chargedCents, input.currency) })]),
      ...(input.aiUseCents
        ? [fill(copy.ai, { amount: money(lang, input.aiUseCents, "usd") })]
        : []),
      ...(input.renewsAt
        ? [
            fill(copy.renewal, {
              date: day(lang, input.renewsAt),
              amount: money(lang, input.renewalCents, input.currency),
            }),
          ]
        : []),
      copy.cancel,
    ],
    action: { label: copy.manage, url: billingSettingsUrl(context.webOrigin) },
    note: fill(copy.terms, { url: context.termsUrl }),
  });
}

export interface RenewalReminder {
  to: string;
  locale: string | null;
  plan: PlanId;
  currency: BillingCurrency;
  renewsAt: Date;
  amountCents: number;
}

/** Said before a yearly charge: when, how much, and how to avoid it. */
export function renewalReminderEmail(
  context: NoticeContext,
  input: RenewalReminder,
): Promise<TransactionalEmail> {
  const lang = billingEmailLocale(input.locale);
  const copy = BILLING_EMAIL_COPY[lang];
  const date = day(lang, input.renewsAt);
  const subject = fill(copy.reminderSubject, { date });
  return noticeEmail(context.webOrigin, {
    to: input.to,
    lang,
    subject,
    title: subject,
    lines: [
      fill(copy.reminderCharge, {
        date,
        amount: money(lang, input.amountCents, input.currency),
        plan: copy.plans[input.plan],
      }),
      copy.reminderCancel,
    ],
    action: { label: copy.manage, url: billingSettingsUrl(context.webOrigin) },
    note: fill(copy.terms, { url: context.termsUrl }),
  });
}
