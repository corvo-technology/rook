import type { BillingSubscriptionSnapshot, TransactionalEmailProvider } from "@corvo/adapter-kit";
import type { AiUseCents } from "@corvo/contracts";
import { AiUseCentsSchema, parsePlanLookupKey } from "@corvo/contracts";
import type { BillingAccount, PrismaClient } from "@corvo/db";
import {
  billingNoticeRecipients,
  claimBillingNotice,
  organizationSeats,
  releaseBillingNotice,
  runAsSystem,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import {
  billingConfirmationEmail,
  planChargeCents,
  planPeople,
  renewalReminderEmail,
} from "./billing-email.js";
import { configuredEmailProvider } from "./email.js";

const DAY_MS = 86_400_000;
/** Days before a yearly renewal that the customer is reminded, earliest first. */
const REMINDER_DAYS = [30, 7] as const;

const live = (status: string | null) => status === "active" || status === "trialing";
const ai = (value: number | null | undefined): AiUseCents | null => {
  const parsed = AiUseCentsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * The emails consumer law asks of a paid plan: a confirmation the customer can keep, and for a
 * yearly plan a reminder before it renews. Each is claimed in `billing_notices` first, so a
 * repeated webhook or a second run of the daily job sends nothing. Without a mailer nothing is
 * sent and nothing is claimed.
 */
export function createBillingNotices(deps: {
  prisma: PrismaClient;
  email?: TransactionalEmailProvider | undefined;
  webOrigin: string;
  /** Where the terms are published; defaults to the app's own `/terms/`. */
  termsUrl?: string;
}) {
  const { prisma, email } = deps;
  const context = {
    webOrigin: deps.webOrigin,
    termsUrl: deps.termsUrl ?? new URL("/terms/", deps.webOrigin).href,
  };

  /** Claims the notice and sends it to the owners; gives the claim back when no one got it. */
  async function sendOnce(
    notice: {
      kind: "confirmation" | "renewal_reminder";
      organizationId: string;
      subscriptionId: string;
      key: string;
    },
    build: (to: {
      email: string;
      locale: string | null;
    }) => Promise<Parameters<TransactionalEmailProvider["send"]>[0]>,
  ): Promise<boolean> {
    if (!email) return false;
    if (!(await claimBillingNotice(prisma, notice))) return false;
    const recipients = await billingNoticeRecipients(prisma, notice.organizationId);
    const results = await Promise.allSettled(
      recipients.map(async (to) => email.send(await build(to))),
    );
    for (const result of results)
      if (result.status === "rejected") getLogger().error("billing email failed", result.reason);
    if (results.some((result) => result.status === "fulfilled")) return true;
    await releaseBillingNotice(prisma, notice.key);
    return false;
  }

  return {
    /**
     * Reminds the owners of every yearly plan that renews within 30 days, once at 30 days and
     * once at 7 days before the renewal. A plan set to cancel is skipped. The threshold is the
     * nearest one still ahead, so a run that comes late sends the one that is still useful.
     */
    remindRenewals(now = new Date()): Promise<number> {
      if (!email) return Promise.resolve(0);
      return runAsSystem("billing renewal reminders", async () => {
        const accounts = await prisma.billingAccount.findMany({
          where: {
            interval: "year",
            status: "active",
            cancelAtPeriodEnd: false,
            endedAt: null,
            subscriptionId: { not: null },
            priceLookupKey: { not: null },
            currentPeriodEndsAt: {
              gt: now,
              lte: new Date(now.getTime() + REMINDER_DAYS[0] * DAY_MS),
            },
          },
        });
        let sent = 0;
        for (const account of accounts) {
          const catalog = parsePlanLookupKey(account.priceLookupKey);
          const renewsAt = account.currentPeriodEndsAt;
          if (!catalog || !renewsAt || !account.subscriptionId) continue;
          const daysLeft = (renewsAt.getTime() - now.getTime()) / DAY_MS;
          const threshold = daysLeft > REMINDER_DAYS[1] ? REMINDER_DAYS[0] : REMINDER_DAYS[1];
          try {
            // What renews is the waiting change when there is one.
            const waiting = parsePlanLookupKey(account.pendingPlanKey);
            const next = waiting ?? catalog;
            const people = planPeople(
              next.plan,
              (await organizationSeats(prisma, account.organizationId)).total,
            );
            const amountCents = planChargeCents({
              plan: next.plan,
              currency: catalog.currency,
              interval: next.interval,
              people,
              aiUseCents: waiting ? ai(account.pendingAiUseCents) : ai(account.aiUseCents),
            });
            const delivered = await sendOnce(
              {
                kind: "renewal_reminder",
                organizationId: account.organizationId,
                subscriptionId: account.subscriptionId,
                key: [
                  "renewal_reminder",
                  account.subscriptionId,
                  renewsAt.toISOString(),
                  threshold,
                ].join(":"),
              },
              (to) =>
                renewalReminderEmail(context, {
                  to: to.email,
                  locale: to.locale,
                  plan: next.plan,
                  currency: catalog.currency,
                  renewsAt,
                  amountCents,
                }),
            );
            if (delivered) sent += 1;
          } catch (error) {
            getLogger().error("billing renewal reminder", error);
          }
        }
        return sent;
      });
    },

    /**
     * Called after a sync with the subscription as stored before it and as the provider reports
     * it now. Sends the confirmation when a plan became active or a change to it took effect.
     */
    confirm(previous: BillingAccount, current: BillingSubscriptionSnapshot): Promise<boolean> {
      const catalog = parsePlanLookupKey(current.priceLookupKey);
      if (!email || !catalog || !live(current.status)) return Promise.resolve(false);
      const activated =
        previous.subscriptionId !== current.subscriptionId || !live(previous.status);
      const changed =
        !activated &&
        (previous.priceLookupKey !== current.priceLookupKey ||
          ai(previous.aiUseCents) !== ai(current.aiUseCents));
      if (!activated && !changed) return Promise.resolve(false);
      const aiUseCents = ai(current.aiUseCents);
      const renewsAt = current.currentPeriodEndsAt;
      return runAsSystem("billing confirmation email", async () => {
        const people = planPeople(
          catalog.plan,
          (await organizationSeats(prisma, previous.organizationId)).total,
        );
        const charge = (selection: {
          plan: typeof catalog.plan;
          interval: typeof catalog.interval;
          aiUseCents: AiUseCents | null;
        }) => planChargeCents({ ...selection, currency: catalog.currency, people });
        const now = { plan: catalog.plan, interval: catalog.interval, aiUseCents };
        // What renews is the waiting change when there is one.
        const waiting = parsePlanLookupKey(current.pendingChange?.priceLookupKey);
        const renewalCents = waiting
          ? charge({
              plan: waiting.plan,
              interval: waiting.interval,
              aiUseCents: current.pendingChange?.aiUseCents ?? null,
            })
          : charge(now);
        // A change that grows applies now and is billed as a difference the plan cannot know.
        const renewed =
          previous.currentPeriodEndsAt?.getTime() !== current.currentPeriodEndsAt?.getTime();
        const key = [
          "confirmation",
          current.subscriptionId,
          current.priceLookupKey,
          aiUseCents ?? 0,
          renewsAt?.toISOString() ?? "none",
        ].join(":");
        return sendOnce(
          {
            kind: "confirmation",
            organizationId: previous.organizationId,
            subscriptionId: current.subscriptionId,
            key,
          },
          (to) =>
            billingConfirmationEmail(context, {
              to: to.email,
              locale: to.locale,
              plan: catalog.plan,
              currency: catalog.currency,
              interval: catalog.interval,
              people,
              chargedCents: activated || renewed ? charge(now) : null,
              aiUseCents,
              renewsAt,
              renewalCents,
              changed: !activated,
            }),
        );
      }).catch((error) => {
        // A failed email never fails the sync that found the change.
        getLogger().error("billing confirmation email", error);
        return false;
      });
    },
  };
}

export type BillingNotices = ReturnType<typeof createBillingNotices>;

/**
 * The daily reminder job for a process that reads its email settings from the environment, at
 * most once a day however often the reconciler calls it.
 */
export function createBillingReminderJobFromEnv(
  prisma: PrismaClient,
  env: Record<string, string | undefined>,
): () => Promise<void> {
  const value = (key: string) => env[key]?.trim() || undefined;
  const notices = createBillingNotices({
    prisma,
    webOrigin: value("WEB_ORIGIN") ?? "http://127.0.0.1:5173",
    email: configuredEmailProvider({
      emailProvider: value("EMAIL_PROVIDER"),
      emailApiKey: value("EMAIL_API_KEY"),
      emailApiUrl: value("EMAIL_API_URL"),
      emailFrom: value("EMAIL_FROM"),
      smtpUrl: value("SMTP_URL"),
    }),
  });
  let last: number | undefined;
  return async () => {
    const now = Date.now();
    if (last !== undefined && now - last < DAY_MS) return;
    last = now;
    await notices.remindRenewals(new Date(now));
  };
}
