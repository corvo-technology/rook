import type {
  BillingPlanSelection,
  BillingPrice,
  BillingProvider,
  BillingSubscriptionSnapshot,
} from "@corvo/adapter-kit";
import {
  BillingCheckoutCompletedError,
  BillingCustomerNotFoundError,
  BillingPaymentRequiredError,
} from "@corvo/adapter-kit";
import type {
  Actor,
  BillingStatus,
  PlanCheckoutInput,
  PlanId,
  PlanSelection,
} from "@corvo/contracts";
import {
  AiUseCentsSchema,
  BillingCurrencySchema,
  BillingIntervalSchema,
  BYOK_MONTHLY_PRICE_CENTS,
  DEFAULT_PLANS,
  extraPersonLookupKey,
  PLAN_ERROR_CODES,
  parsePlanLookupKey,
  planConfigFromEnv,
  resolvePlanChange,
  samePlanSelection,
  TERMS_VERSION,
} from "@corvo/contracts";
import type { BillingAccount, PrismaClient } from "@corvo/db";
import {
  billingAccountForOrganization,
  byokFreeUntil,
  createBillingAccount,
  creditAccount,
  expireModelCredits,
  extraSeats,
  hasBillingAccess,
  hasModelAccess,
  MICROS_PER_DOLLAR,
  needsBillingPortal,
  organizationEntitlements,
  organizationForMember,
  organizationSeatCount,
  organizationSeats,
  ownedBillingAccounts,
  reconcileCreditPurchase,
  replaceBillingCustomer,
  syncBillingSnapshot,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ORPCError } from "@orpc/server";
import type { BillingNotices } from "./billing-notices.js";

/**
 * Days of free trial before the first charge, or null for none. Stripe needs at least 1 day, so a
 * trial is either a positive number of days or not sent at all.
 */
export const TRIAL_DAYS: number | null = null;
const PRICE_CACHE_MS = 60 * 60 * 1000;
/** Stripe returns here after checkout; served by the API through the web origin. */
export const BILLING_RETURN_PATH = "/api/v1/billing/return";

/** Product-side billing: access rules, checkout, and pull-based sync from the provider. */
export interface BillingService {
  readonly modelCreditsEnabled: boolean;
  status(actor: Actor): Promise<BillingStatus>;
  selectFunding(actor: Actor, funding: "byok" | "credits"): Promise<{ ok: true; url?: string }>;
  purchaseCredits(
    actor: Actor,
    input: { amountCents: number; monthly: boolean },
  ): Promise<{ url: string }>;
  setMonthlyCredits(actor: Actor, amountCents: number): Promise<{ ok: true }>;
  checkout(actor: Actor): Promise<{ url: string }>;
  /** Opens the checkout of a plan in the chosen currency; the owner only. */
  planCheckout(actor: Actor, input: PlanCheckoutInput): Promise<{ url: string }>;
  /**
   * Moves a subscribed organization to another plan, interval or AI amount; the owner only. What
   * grows applies now with proration and what shrinks at the next renewal. `url` is set only when
   * the payment needs the owner, and then nothing has changed.
   */
  changePlan(actor: Actor, input: PlanCheckoutInput): Promise<{ ok: true; url?: string }>;
  portal(actor: Actor): Promise<{ url: string }>;
  /** Re-fetches the customer's subscription from the provider and overwrites the stored snapshot. */
  sync(customerId: string): Promise<void>;
  /** Syncs the actor's organization, e.g. on return from checkout before the webhook lands. */
  syncForActor(actor: Actor): Promise<void>;
  /** Pushes the organization's member count to the provider. Call when members change. */
  syncSeats(organizationId: string): Promise<void>;
  cancelForDeletedUser(userId: string): Promise<void>;
  /** What one seat above the plan's included ones costs; null when it has no price. */
  extraSeatPrice(priceId: string): Promise<BillingPrice | null>;
  /**
   * What one extra seat costs this organization: the price in its subscription's currency and
   * interval, else `fallbackPriceId`, the deployment's single extra seat price. Null when none.
   */
  extraSeatPriceFor(organizationId: string, fallbackPriceId?: string): Promise<BillingPrice | null>;
}

/**
 * Only the own-key plan has a trial: credits are resold at cost. An organization that has
 * subscribed before, or was given a free own-key period, has had its trial.
 */
function byokTrialAvailable(
  account: { subscribedAt: Date | null } | null,
  credits: { byokFreeUntil: Date | null },
) {
  return !account?.subscribedAt && !credits.byokFreeUntil;
}

function limitsFor(plan: PlanId) {
  return (planConfigFromEnv()?.plans ?? DEFAULT_PLANS)[plan];
}

export function createBillingService(deps: {
  prisma: PrismaClient;
  provider: BillingProvider;
  managedModelsAvailable?: boolean;
  /** The session cookie lives on the web origin, which also proxies /api to this server. */
  webOrigin: string;
  /** Overrides `TRIAL_DAYS`; null or a non-positive number means no trial. */
  trialDays?: number | null;
  /** Sends the confirmation when a sync finds a plan became active or changed. */
  notices?: BillingNotices;
}): BillingService {
  const { prisma, provider } = deps;
  const configuredDays = deps.trialDays === undefined ? TRIAL_DAYS : deps.trialDays;
  const trialDays = configuredDays !== null && configuredDays >= 1 ? configuredDays : null;
  const appUrl = `${deps.webOrigin}/app`;
  const modelCredits = provider.describe().capabilities.modelCredits === true;
  let cachedPrice: { value: BillingPrice; expiresAt: number } | undefined;
  const extraSeatPrices = new Map<string, { value: BillingPrice; expiresAt: number }>();

  async function price(): Promise<BillingPrice | null> {
    if (cachedPrice && cachedPrice.expiresAt > Date.now()) return cachedPrice.value;
    try {
      const value = await provider.getPrice();
      cachedPrice = { value, expiresAt: Date.now() + PRICE_CACHE_MS };
      return value;
    } catch (error) {
      getLogger().error("billing price lookup failed", error);
      return null;
    }
  }

  async function organization(actor: Actor) {
    const found = await organizationForMember(prisma, {
      spaceId: actor.spaceId,
      userId: actor.userId,
    });
    if (!found) throw new ORPCError("FORBIDDEN");
    return found;
  }

  async function managedOrganization(actor: Actor) {
    const found = await organization(actor);
    if (!found.isOwner) throw new ORPCError("FORBIDDEN");
    return found;
  }

  async function sync(customerId: string): Promise<void> {
    if (modelCredits && provider.listCreditPurchases) {
      const account = await prisma.billingAccount.findUnique({ where: { customerId } });
      if (account) {
        let added = false;
        for (const purchase of await provider.listCreditPurchases(customerId)) {
          if ((await reconcileCreditPurchase(prisma, account.organizationId, purchase)) > 0)
            added = true;
        }
        await prisma.modelCreditAccount.updateMany({
          where: {
            organizationId: account.organizationId,
            balanceMicros: { gt: 0n },
            OR: [{ mode: null }, ...(added ? [{ pendingCreditCheckout: true }] : [])],
          },
          data: { mode: "credits", pendingCreditCheckout: false },
        });
      }
    }
    const previous = await prisma.billingAccount.findUnique({ where: { customerId } });
    // Assigned in the callback, which control-flow narrowing does not follow.
    let snapshot = null as BillingSubscriptionSnapshot | null;
    const written = await syncBillingSnapshot(prisma, customerId, async () => {
      snapshot = await provider.getCustomerSubscription(customerId);
      return snapshot;
    });
    if (!written || !previous) {
      getLogger().warn("billing sync for unknown customer", { "billing.customer_id": customerId });
      return;
    }
    const live = snapshot;
    if (live) await deps.notices?.confirm(previous, live);
    if (!modelCredits || !live) return;
    // A newly paid own-key plan becomes the funding, wherever its checkout returned.
    if (
      live.byokPlan &&
      hasBillingAccess(live.status) &&
      live.subscriptionId !== previous.subscriptionId
    )
      // Only while this snapshot is still the stored one: a newer sync's write wins.
      await prisma.modelCreditAccount.updateMany({
        where: {
          organizationId: previous.organizationId,
          organization: { billing: { subscriptionId: live.subscriptionId } },
        },
        data: { mode: "byok", pendingCreditCheckout: false },
      });
    // The AI add-on decides the funding, on the change only so a later choice stands: turning it
    // on moves to Rook's models, and its removal, which takes effect at renewal, back to the
    // organization's own AI. The balance is never touched.
    if (hasBillingAccess(live.status) && parsePlanLookupKey(live.priceLookupKey)) {
      const switchTo =
        live.aiUseCents && !previous.aiUseCents
          ? "credits"
          : !live.aiUseCents && previous.aiUseCents
            ? "byok"
            : null;
      if (switchTo) {
        await creditAccount(prisma, previous.organizationId);
        await prisma.modelCreditAccount.updateMany({
          where: {
            organizationId: previous.organizationId,
            organization: { billing: { subscriptionId: live.subscriptionId } },
          },
          data: { mode: switchTo, pendingCreditCheckout: false },
        });
      }
    }
    // Monthly credits include the own-key plan, even when they will not renew, and a free plan
    // bills nothing.
    if (
      provider.endByokPlans &&
      hasBillingAccess(live.status) &&
      (live.creditAmountCents ||
        (BYOK_MONTHLY_PRICE_CENTS === null && live.byokPlan && !live.cancelAtPeriodEnd))
    )
      await provider.endByokPlans(customerId);
  }

  async function newCustomer(actor: Actor, organizationId: string) {
    return (await provider.createCustomer({ email: actor.email, organizationId })).customerId;
  }

  /** Runs `call`; if the provider deleted the customer, swaps in a new one and runs it again. */
  async function withLiveCustomer<T>(
    actor: Actor,
    account: BillingAccount,
    call: (customerId: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await call(account.customerId);
    } catch (error) {
      if (!(error instanceof BillingCustomerNotFoundError)) throw error;
      const replaced = await replaceBillingCustomer(prisma, {
        organizationId: account.organizationId,
        previousCustomerId: account.customerId,
        customerId: await newCustomer(actor, account.organizationId),
      });
      return call(replaced.customerId);
    }
  }

  /** Opens a checkout; with `serialize`, one per organization at a time across API instances. */
  async function openCheckout<T = { url: string }>(
    actor: Actor,
    account: BillingAccount,
    serialize: boolean,
    call: (customerId: string) => Promise<T>,
  ) {
    return prisma.$transaction(
      async (tx) => {
        // Opening another recurring checkout expires the old one.
        if (serialize)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`model-credit-checkout:${account.organizationId}`}, 0))`;
        return withLiveCustomer(actor, account, call);
      },
      { timeout: 120_000 },
    );
  }

  async function billingAccountFor(actor: Actor, organizationId: string) {
    return (
      (await billingAccountForOrganization(prisma, organizationId)) ??
      createBillingAccount(prisma, {
        organizationId,
        customerId: await newCustomer(actor, organizationId),
      })
    );
  }

  /** What a subscription says about its plan, for the status. */
  function planFields(
    account: {
      priceLookupKey: string | null;
      currency: string | null;
      interval: string | null;
      aiUseCents: number | null;
      pendingPlanKey: string | null;
      pendingAiUseCents: number | null;
      currentPeriodEndsAt: Date | null;
    } | null,
  ): Pick<BillingStatus, "plan" | "currency" | "interval" | "aiUseCents" | "pendingChange"> {
    const catalog = parsePlanLookupKey(account?.priceLookupKey);
    if (!account || !catalog) return {};
    const pending = parsePlanLookupKey(account.pendingPlanKey);
    const ai = AiUseCentsSchema.safeParse(account.aiUseCents);
    const pendingAi = AiUseCentsSchema.safeParse(account.pendingAiUseCents);
    return {
      plan: catalog.plan,
      currency: catalog.currency,
      interval: catalog.interval,
      ...(ai.success ? { aiUseCents: ai.data } : {}),
      ...(pending && account.currentPeriodEndsAt
        ? {
            pendingChange: {
              plan: pending.plan,
              interval: pending.interval,
              aiUseCents: pendingAi.success ? pendingAi.data : null,
              effectiveAt: account.currentPeriodEndsAt.toISOString(),
            },
          }
        : {}),
    };
  }

  /**
   * The extra person price to bill: a subscription bought from the catalog follows its own
   * currency and interval; one set up by hand keeps the deployment's single extra seat price.
   */
  async function extraSeatPriceId(
    account: { currency: string | null; interval: string | null },
    fallbackPriceId: string | undefined,
  ): Promise<string | null> {
    const currency = BillingCurrencySchema.safeParse(account.currency);
    const interval = BillingIntervalSchema.safeParse(account.interval);
    if (!currency.success || !interval.success) return fallbackPriceId ?? null;
    const key = extraPersonLookupKey(currency.data, interval.data);
    const found = (await provider.priceIdForLookupKey?.(key)) ?? null;
    // Never another currency's price: the provider would refuse it, or bill it wrongly.
    if (!found) getLogger().error("extra person price missing", { "billing.lookup_key": key });
    return found;
  }

  async function extraSeatPriceById(priceId: string): Promise<BillingPrice | null> {
    if (!provider.getPriceById) return null;
    const cached = extraSeatPrices.get(priceId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const value = await provider.getPriceById(priceId);
      extraSeatPrices.set(priceId, { value, expiresAt: Date.now() + PRICE_CACHE_MS });
      return value;
    } catch (error) {
      getLogger().error("extra seat price lookup failed", error);
      return null;
    }
  }

  /**
   * Changing people edits the subscription, which drops the waiting change. Put it back with the
   * extra people the new count needs, or let it go when the plan it moves to no longer fits them.
   */
  async function keepPendingChange(account: BillingAccount, total: number): Promise<void> {
    const pending = parsePlanLookupKey(account.pendingPlanKey);
    if (!pending || !provider.changePlan) return;
    const ai = AiUseCentsSchema.safeParse(account.pendingAiUseCents);
    const limits = limitsFor(pending.plan);
    await provider.changePlan({
      customerId: account.customerId,
      apply: null,
      atRenewal:
        total > limits.maxSeats
          ? null
          : {
              plan: pending.plan,
              currency: pending.currency,
              interval: pending.interval,
              extraPeople: extraSeats(limits, total),
              aiUseCents: ai.success ? ai.data : null,
            },
    });
  }

  async function byokCheckout(actor: Actor, organizationId: string) {
    const amountCents = BYOK_MONTHLY_PRICE_CENTS;
    if (amountCents === null || !provider.createByokCheckout) throw new ORPCError("NOT_FOUND");
    const [account, credits] = await Promise.all([
      billingAccountFor(actor, organizationId),
      creditAccount(prisma, organizationId),
    ]);
    try {
      return await openCheckout(actor, account, true, (customerId) =>
        provider.createByokCheckout!({
          customerId,
          amountCents,
          termsVersion: TERMS_VERSION,
          ...(trialDays !== null && byokTrialAvailable(account, credits) ? { trialDays } : {}),
          successUrl: `${deps.webOrigin}${BILLING_RETURN_PATH}`,
          cancelUrl: appUrl,
        }),
      );
    } catch (error) {
      if (!(error instanceof BillingCheckoutCompletedError)) throw error;
      await sync(account.customerId);
      throw new ORPCError("CONFLICT", { message: "Manage your existing subscription in Billing" });
    }
  }

  return {
    modelCreditsEnabled: modelCredits,
    async selectFunding(actor, funding) {
      const { organizationId } = await managedOrganization(actor);
      const account = await creditAccount(prisma, organizationId);
      const subscription = await billingAccountForOrganization(prisma, organizationId);
      if (
        funding === "byok" &&
        subscription?.creditAmountCents &&
        !subscription.cancelAtPeriodEnd &&
        !["canceled", "incomplete_expired"].includes(subscription.status ?? "")
      )
        throw new ORPCError("CONFLICT", {
          message: "Cancel monthly credits in Billing before switching to your API key.",
        });
      // An unpaid own-key choice keeps the current funding until checkout completes.
      if (
        funding === "byok" &&
        !hasModelAccess({ ...account, mode: "byok" }, subscription?.status ?? null)
      )
        return { ok: true, ...(await byokCheckout(actor, organizationId)) };
      await prisma.modelCreditAccount.update({
        where: { organizationId },
        data: {
          mode: funding === "byok" ? "byok" : account.balanceMicros > 0n ? "credits" : null,
          pendingCreditCheckout: false,
        },
      });
      return { ok: true };
    },

    async purchaseCredits(actor, input) {
      if (!modelCredits || !provider.createCreditCheckout) throw new ORPCError("NOT_FOUND");
      if (deps.managedModelsAvailable === false) throw new ORPCError("PRECONDITION_FAILED");
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountFor(actor, organizationId);
      await creditAccount(prisma, organizationId);
      try {
        const checkout = await openCheckout(actor, account, input.monthly, (customerId) =>
          provider.createCreditCheckout!({
            customerId,
            ...input,
            termsVersion: TERMS_VERSION,
            successUrl: `${deps.webOrigin}${BILLING_RETURN_PATH}`,
            cancelUrl: `${appUrl}?billing=canceled`,
          }),
        );
        await prisma.modelCreditAccount.update({
          where: { organizationId },
          data: { pendingCreditCheckout: true },
        });
        return checkout;
      } catch (error) {
        if (error instanceof BillingCheckoutCompletedError)
          throw new ORPCError("CONFLICT", {
            message: "Manage your existing subscription in Billing",
          });
        throw error;
      }
    },

    async setMonthlyCredits(actor, amountCents) {
      if (!modelCredits || !provider.setMonthlyCredits) throw new ORPCError("NOT_FOUND");
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) throw new ORPCError("NOT_FOUND");
      await provider.setMonthlyCredits(account.customerId, amountCents);
      await sync(account.customerId);
      return { ok: true };
    },

    async status(actor) {
      if (modelCredits) {
        const { organizationId, isOwner } = await organization(actor);
        await expireModelCredits(prisma, organizationId);
        const [credits, account] = await Promise.all([
          creditAccount(prisma, organizationId),
          billingAccountForOrganization(prisma, organizationId),
        ]);
        const freeUntil =
          credits.mode === "byok" &&
          BYOK_MONTHLY_PRICE_CENTS !== null &&
          !hasBillingAccess(account?.status ?? null)
            ? byokFreeUntil(credits)
            : null;
        return {
          access: hasModelAccess(credits, account?.status ?? null),
          funding:
            credits.mode === "byok"
              ? "byok"
              : credits.balanceMicros > 0n || credits.mode === "credits"
                ? "credits"
                : null,
          balanceUsd: Number(credits.balanceMicros) / MICROS_PER_DOLLAR,
          monthlyAmountCents: account?.creditAmountCents ?? null,
          creditPurchasesEnabled: deps.managedModelsAvailable ?? true,
          byokPriceCents: BYOK_MONTHLY_PRICE_CENTS,
          byokFreeUntil: freeUntil?.toISOString() ?? null,
          canManage: isOwner,
          trialAvailable:
            trialDays !== null &&
            BYOK_MONTHLY_PRICE_CENTS !== null &&
            byokTrialAvailable(account, credits),
          trialDays: trialDays ?? 0,
          state: (account?.status ?? "none") as BillingStatus["state"],
          price: account?.creditAmountCents
            ? {
                amount: account.creditAmountCents,
                currency: "usd",
                interval: "month" as const,
                intervalCount: 1,
              }
            : null,
          seats: 1,
          trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
          currentPeriodEndsAt: account?.currentPeriodEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
          hasCustomer: Boolean(account),
          ...planFields(account),
        };
      }
      const { organizationId, isOwner } = await organization(actor);
      const [account, currentPrice] = await Promise.all([
        billingAccountForOrganization(prisma, organizationId),
        price(),
      ]);
      const status = account?.status ?? null;
      return {
        access: hasBillingAccess(status),
        canManage: isOwner,
        trialAvailable: trialDays !== null && !account?.subscribedAt,
        trialDays: trialDays ?? 0,
        state: (status ?? "none") as BillingStatus["state"],
        price: currentPrice,
        seats: account?.seats ?? (await organizationSeatCount(prisma, organizationId)),
        trialEndsAt: account?.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: account?.currentPeriodEndsAt?.toISOString() ?? null,
        cancelAtPeriodEnd: account?.cancelAtPeriodEnd ?? false,
        hasCustomer: Boolean(account),
        ...planFields(account),
      };
    },

    async planCheckout(actor, input) {
      if (!provider.createPlanCheckout) throw new ORPCError("NOT_FOUND");
      if (input.aiUseCents !== null && (!modelCredits || deps.managedModelsAvailable === false))
        throw new ORPCError("PRECONDITION_FAILED");
      const { organizationId } = await managedOrganization(actor);
      let account = await billingAccountForOrganization(prisma, organizationId);
      if (account) {
        // Decide from the provider, not a snapshot a missed webhook may have left stale.
        await sync(account.customerId);
        account = await billingAccountForOrganization(prisma, organizationId);
      }
      if (hasBillingAccess(account?.status ?? null))
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      if (needsBillingPortal(account?.status ?? null))
        throw new ORPCError("CONFLICT", { message: "Resume the subscription in billing" });
      // The provider fixes a customer's currency at the first payment.
      if (account?.currency && account.currency !== input.currency)
        throw new ORPCError("CONFLICT", {
          message: "Billing currency is fixed by the first payment",
        });
      const limits = (planConfigFromEnv()?.plans ?? DEFAULT_PLANS)[input.plan];
      const { total } = await organizationSeats(prisma, organizationId);
      // Never a plan that would leave people without a seat.
      if (total > limits.maxSeats)
        throw new ORPCError(PLAN_ERROR_CODES.seatLimit, {
          status: 402,
          message: `The ${input.plan} plan allows ${limits.maxSeats} people`,
        });
      const target = account ?? (await billingAccountFor(actor, organizationId));
      try {
        return await openCheckout(actor, target, true, (customerId) =>
          provider.createPlanCheckout!({
            customerId,
            plan: input.plan,
            currency: input.currency,
            interval: input.interval,
            extraPeople: extraSeats(limits, total),
            aiUseCents: input.aiUseCents,
            termsVersion: TERMS_VERSION,
            successUrl: `${deps.webOrigin}${BILLING_RETURN_PATH}`,
            cancelUrl: `${appUrl}?billing=canceled`,
          }),
        );
      } catch (error) {
        if (!(error instanceof BillingCheckoutCompletedError)) throw error;
        await sync(target.customerId);
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      }
    },

    async changePlan(actor, input) {
      if (!provider.changePlan) throw new ORPCError("NOT_FOUND");
      if (input.aiUseCents !== null && (!modelCredits || deps.managedModelsAvailable === false))
        throw new ORPCError("PRECONDITION_FAILED");
      const { organizationId } = await managedOrganization(actor);
      let account = await billingAccountForOrganization(prisma, organizationId);
      if (account) {
        // Decide from the provider, not a snapshot a missed webhook may have left stale.
        await sync(account.customerId);
        account = await billingAccountForOrganization(prisma, organizationId);
      }
      if (!account || !hasBillingAccess(account.status))
        throw new ORPCError("CONFLICT", { message: "No subscription to change" });
      if (account.cancelAtPeriodEnd)
        throw new ORPCError("CONFLICT", { message: "Resume the subscription in billing" });
      // The provider fixes a customer's currency at the first payment. A subscription that is
      // not on a catalog plan, the own-key plan or monthly credits, was paid in dollars.
      if ((account.currency ?? "usd") !== input.currency)
        throw new ORPCError("CONFLICT", {
          message: "Billing currency is fixed by the first payment",
        });
      const limits = limitsFor(input.plan);
      const { total } = await organizationSeats(prisma, organizationId);
      // Never a plan that would leave people without a seat.
      if (total > limits.maxSeats)
        throw new ORPCError(PLAN_ERROR_CODES.seatLimit, {
          status: 402,
          message: `The ${input.plan} plan allows ${limits.maxSeats} people`,
        });
      const catalog = parsePlanLookupKey(account.priceLookupKey);
      const ai = AiUseCentsSchema.safeParse(account.aiUseCents);
      const current: PlanSelection | null = catalog
        ? {
            plan: catalog.plan,
            interval: catalog.interval,
            aiUseCents: ai.success ? ai.data : null,
          }
        : null;
      const target: PlanSelection = {
        plan: input.plan,
        interval: input.interval,
        aiUseCents: input.aiUseCents,
      };
      const { now, pending } = resolvePlanChange(current, target);
      const waiting = Boolean(account.pendingPlanKey);
      const apply = !current || !samePlanSelection(current, now);
      // Nothing to do when the plan is already as chosen and nothing waits to be replaced.
      if (!apply && !pending && !waiting) return { ok: true };
      const selection = (chosen: PlanSelection): BillingPlanSelection => ({
        ...chosen,
        currency: input.currency,
        extraPeople: extraSeats(limitsFor(chosen.plan), total),
      });
      try {
        await openCheckout(actor, account, true, (customerId) =>
          provider.changePlan!({
            customerId,
            apply: apply ? selection(now) : null,
            atRenewal: pending ? selection(pending) : null,
          }),
        );
      } catch (error) {
        if (!(error instanceof BillingPaymentRequiredError)) throw error;
        // The change did not happen; the portal is where the owner fixes how they pay.
        return {
          ok: true,
          ...(await withLiveCustomer(actor, account, (customerId) =>
            provider.createPortal({ customerId, returnUrl: `${appUrl}?billing=canceled` }),
          )),
        };
      }
      await sync(account.customerId);
      return { ok: true };
    },

    async checkout(actor) {
      const { organizationId } = await managedOrganization(actor);
      if (modelCredits) return byokCheckout(actor, organizationId);
      let account = await billingAccountForOrganization(prisma, organizationId);
      if (account) {
        // Decide from the provider, not a snapshot a missed webhook may have left stale.
        await sync(account.customerId);
        account = await billingAccountForOrganization(prisma, organizationId);
      }
      if (hasBillingAccess(account?.status ?? null)) {
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      }
      // The existing subscription resumes once paid; a new checkout would bill twice.
      if (needsBillingPortal(account?.status ?? null)) {
        throw new ORPCError("CONFLICT", { message: "Resume the subscription in billing" });
      }
      account ??= await createBillingAccount(prisma, {
        organizationId,
        customerId: await newCustomer(actor, organizationId),
      });
      const seats = await organizationSeatCount(prisma, organizationId);
      const trial = account.subscribedAt || trialDays === null ? {} : { trialDays };
      try {
        return await withLiveCustomer(actor, account, (customerId) =>
          provider.createCheckout({
            customerId,
            seats,
            ...trial,
            termsVersion: TERMS_VERSION,
            successUrl: `${deps.webOrigin}${BILLING_RETURN_PATH}`,
            cancelUrl: appUrl,
          }),
        );
      } catch (error) {
        if (!(error instanceof BillingCheckoutCompletedError)) throw error;
        await sync(account.customerId);
        throw new ORPCError("CONFLICT", { message: "Already subscribed" });
      }
    },

    async portal(actor) {
      const { organizationId } = await managedOrganization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account) throw new ORPCError("NOT_FOUND", { message: "No billing account" });
      return withLiveCustomer(actor, account, (customerId) =>
        provider.createPortal({ customerId, returnUrl: appUrl }),
      );
    },

    sync,

    async syncForActor(actor) {
      const { organizationId } = await organization(actor);
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (account) await sync(account.customerId);
    },

    extraSeatPrice: extraSeatPriceById,

    async extraSeatPriceFor(organizationId, fallbackPriceId) {
      const account = await billingAccountForOrganization(prisma, organizationId);
      const priceId = await extraSeatPriceId(
        account ?? { currency: null, interval: null },
        fallbackPriceId,
      );
      return priceId ? extraSeatPriceById(priceId) : null;
    },

    async syncSeats(organizationId) {
      const account = await billingAccountForOrganization(prisma, organizationId);
      if (!account || account.creditAmountCents) return;
      // Under plans the price includes people; only seats above that are billed, on their own line.
      if (planConfigFromEnv()) {
        const limits = await organizationEntitlements(prisma, planConfigFromEnv(), organizationId);
        if (!limits || !provider.setExtraSeats) return;
        const priceId = await extraSeatPriceId(account, limits.extraSeatPriceId);
        if (!priceId) return;
        const { total } = await organizationSeats(prisma, organizationId);
        await provider.setExtraSeats(account.customerId, {
          priceId,
          quantity: extraSeats(limits, total),
        });
        await keepPendingChange(account, total);
        await sync(account.customerId);
        return;
      }
      const seats = await organizationSeatCount(prisma, organizationId);
      if (account.seats === seats) return;
      await provider.updateSeats(account.customerId, seats);
      await sync(account.customerId);
    },

    async cancelForDeletedUser(userId) {
      for (const account of await ownedBillingAccounts(prisma, userId)) {
        await provider.cancelCustomerSubscriptions(account.customerId);
        await sync(account.customerId);
      }
    },
  };
}
