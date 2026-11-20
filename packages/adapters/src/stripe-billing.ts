import type {
  BillingByokCheckoutRequest,
  BillingCheckoutRequest,
  BillingCreditCheckoutRequest,
  BillingCreditPurchase,
  BillingEvidence,
  BillingPlanChangeRequest,
  BillingPlanCheckoutRequest,
  BillingPlanSelection,
  BillingPrice,
  BillingProvider,
  BillingSubscriptionSnapshot,
  BillingSubscriptionStatus,
} from "@corvo/adapter-kit";
import {
  BillingCheckoutCompletedError,
  BillingCustomerNotFoundError,
  BillingPaymentRequiredError,
} from "@corvo/adapter-kit";
import type { BillingCurrency, BillingInterval } from "@corvo/contracts";
import {
  AI_USE_CENTS,
  aiAddOnPriceCents,
  aiLookupKey,
  aiUseGrantCents,
  BILLING_CURRENCIES,
  BILLING_INTERVALS,
  extraComputerCents,
  extraComputerLookupKey,
  extraPersonCents,
  extraPersonLookupKey,
  ModelCreditAmountSchema,
  PLAN_IDS,
  parseAiLookupKey,
  planLookupKey,
  planPriceCents,
} from "@corvo/contracts";
import { z } from "zod";
import {
  encodeStripeForm,
  StripeHttp,
  StripeRequestError,
  verifyStripeSignature,
} from "./stripe-http.js";

export { encodeStripeForm, STRIPE_API_VERSION, signStripeWebhook } from "./stripe-http.js";

export interface StripeBillingConfig {
  secretKey: string;
  webhookSecret: string;
  priceId?: string;
  fetch?: typeof fetch;
  apiBase?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const priceSchema = z.object({
  unit_amount: z.number().int(),
  currency: z.string(),
  recurring: z.object({
    interval: z.enum(["day", "week", "month", "year"]),
    interval_count: z.number().int(),
  }),
});
const idSchema = z.object({ id: z.string().min(1) });
const urlSchema = z.object({ url: z.string().min(1) });
const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  metadata: z.record(z.string(), z.string()).optional(),
  created: z.number(),
  trial_end: z.number().nullish(),
  current_period_end: z.number().nullish(),
  cancel_at_period_end: z.boolean().nullish(),
  cancel_at: z.number().nullish(),
  ended_at: z.number().nullish(),
  schedule: z.string().nullish(),
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        quantity: z.number().int().nullish(),
        metadata: z.record(z.string(), z.string()).nullish(),
        current_period_end: z.number().nullish(),
        price: idSchema.extend({
          product: z.string().optional(),
          lookup_key: z.string().nullish(),
        }),
      }),
    ),
  }),
});
const subscriptionListSchema = z.object({
  data: z.array(subscriptionSchema),
  has_more: z.boolean(),
});
const checkoutListSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })),
  has_more: z.boolean(),
});
type StripeSubscription = z.infer<typeof subscriptionSchema>;
const scheduleSchema = z.object({
  id: z.string(),
  current_phase: z.object({ start_date: z.number() }).nullish(),
  phases: z.array(
    z.object({
      start_date: z.number(),
      end_date: z.number().nullish(),
      items: z.array(z.object({ price: z.string(), quantity: z.number().int().nullish() })),
    }),
  ),
  metadata: z.record(z.string(), z.string()).nullish(),
});
type StripeSchedule = z.infer<typeof scheduleSchema>;
/** Written on a schedule this adapter made; they say what the waiting phase holds. */
const PENDING_PLAN_METADATA = "corvo_pending_plan";
const PENDING_AI_METADATA = "corvo_pending_ai";

/** Stripe REST wire format and credentials stay inside this adapter. */
export class StripeBillingProvider implements BillingProvider {
  private readonly config: StripeBillingConfig;
  private readonly http: StripeHttp;
  private readonly now: () => number;
  private readonly monthlyPrices = new Map<string, string>();
  private readonly catalogPriceIds = new Map<string, string>();
  private readonly priceInfos = new Map<
    string,
    { use: number; unitAmount: number; catalog: boolean }
  >();

  constructor(config: StripeBillingConfig) {
    this.config = config;
    this.http = new StripeHttp(config);
    this.now = config.now ?? Date.now;
  }

  describe() {
    return {
      id: "stripe",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { trials: true, portal: true, modelCredits: true },
    };
  }

  async getPrice(): Promise<BillingPrice> {
    if (!this.config.priceId) throw new Error("Legacy subscription price is not configured");
    return this.getPriceById(this.config.priceId);
  }

  async getPriceById(priceId: string): Promise<BillingPrice> {
    const price = priceSchema.parse(
      await this.request("GET", `/v1/prices/${encodeURIComponent(priceId)}`),
    );
    return {
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring.interval,
      intervalCount: price.recurring.interval_count,
    };
  }

  async createCustomer(input: { email: string; organizationId: string }) {
    const customer = idSchema.parse(
      await this.request("POST", "/v1/customers", {
        email: input.email,
        metadata: { organization_id: input.organizationId },
      }),
    );
    return { customerId: customer.id };
  }

  async createCheckout(input: BillingCheckoutRequest) {
    if (!this.config.priceId) throw new Error("Legacy subscription price is not configured");
    // An abandoned session has no subscription yet, so the access check still passes.
    // Expire it before opening another; a completed session is not open and stays paid once.
    await this.expireOpenCheckouts(input.customerId);
    // With no open session left, any checkout that completed since the caller's access check,
    // before or during the expiry, has already left its subscription behind.
    const live = await this.listSubscriptions(input.customerId);
    if (live.some((s) => holdsBillingSubscription(mapStripeSubscriptionStatus(s.status))))
      throw new BillingCheckoutCompletedError();
    const body = encodeStripeForm({
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: this.config.priceId, quantity: input.seats }],
      payment_method_collection: "always",
      allow_promotion_codes: true,
      ...termsConsent(input.termsVersion),
      subscription_data: {
        billing_mode: { type: "classic" },
        ...(input.trialDays === undefined ? {} : { trial_period_days: input.trialDays }),
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });
    const session = urlSchema.parse(await this.request("POST", "/v1/checkout/sessions", body));
    return { url: session.url };
  }

  async createCreditCheckout(input: BillingCreditCheckoutRequest) {
    if (!creditAmount(String(input.amountCents))) throw new Error("Invalid credit amount");
    if (input.monthly) {
      await this.expireOpenCheckouts(input.customerId);
      // Credits include the own-key plan, which sync ends once credits start.
      if (
        (await this.listSubscriptions(input.customerId)).some(
          (s) => !isByokPlan(s) && holdsBillingSubscription(mapStripeSubscriptionStatus(s.status)),
        )
      )
        throw new BillingCheckoutCompletedError();
    }
    const metadata = { corvo_credit_cents: String(input.amountCents) };
    const session = urlSchema.parse(
      await this.request("POST", "/v1/checkout/sessions", {
        customer: input.customerId,
        mode: input.monthly ? "subscription" : "payment",
        allowed_payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        line_items: [
          input.monthly
            ? {
                quantity: 1,
                price: await this.monthlyPrice(
                  `corvo_monthly_credits_${input.amountCents}`,
                  input.amountCents,
                  "Rook monthly model credits",
                ),
              }
            : {
                quantity: 1,
                price_data: {
                  currency: CREDIT_CURRENCY,
                  unit_amount: input.amountCents,
                  product_data: { name: "Rook model credits" },
                },
              },
        ],
        ...termsConsent(input.termsVersion, metadata),
        ...(input.monthly
          ? { subscription_data: { metadata, billing_mode: { type: "classic" } } }
          : { payment_intent_data: { metadata }, invoice_creation: { enabled: true } }),
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    );
    return { url: session.url };
  }

  async setMonthlyCredits(customerId: string, amountCents: number) {
    if (!creditAmount(String(amountCents))) throw new Error("Invalid credit amount");
    const subscription = (await this.listSubscriptions(customerId)).find(
      (s) =>
        creditAmount(s.metadata?.corvo_credit_cents) &&
        holdsBillingSubscription(mapStripeSubscriptionStatus(s.status)),
    );
    const item = subscription?.items.data[0];
    const previousAmount = creditAmount(subscription?.metadata?.corvo_credit_cents);
    if (!subscription || !item || !previousAmount)
      throw new Error("No monthly credit subscription");
    if (amountCents === previousAmount) return;
    const upgrading = amountCents > previousAmount;
    await this.request("POST", `/v1/subscriptions/${encodeURIComponent(subscription.id)}`, {
      items: [
        {
          id: item.id,
          price: await this.monthlyPrice(
            `corvo_monthly_credits_${amountCents}`,
            amountCents,
            "Rook monthly model credits",
          ),
          quantity: 1,
        },
      ],
      metadata: { corvo_credit_cents: String(amountCents) },
      proration_behavior: upgrading ? "always_invoice" : "none",
      payment_behavior: "error_if_incomplete",
    });
  }

  async createByokCheckout(input: BillingByokCheckoutRequest) {
    await this.expireOpenCheckouts(input.customerId);
    if (
      (await this.listSubscriptions(input.customerId)).some((s) =>
        holdsBillingSubscription(mapStripeSubscriptionStatus(s.status)),
      )
    )
      throw new BillingCheckoutCompletedError();
    const metadata = { [BYOK_PLAN_METADATA]: "byok" };
    const session = urlSchema.parse(
      await this.request("POST", "/v1/checkout/sessions", {
        customer: input.customerId,
        mode: "subscription",
        allowed_payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        allow_promotion_codes: true,
        line_items: [
          {
            quantity: 1,
            price: await this.monthlyPrice(
              `corvo_byok_monthly_${input.amountCents}`,
              input.amountCents,
              "Rook own-key plan",
            ),
          },
        ],
        ...termsConsent(input.termsVersion, metadata),
        subscription_data: {
          metadata,
          billing_mode: { type: "classic" },
          ...(input.trialDays === undefined ? {} : { trial_period_days: input.trialDays }),
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    );
    return { url: session.url };
  }

  async endByokPlans(customerId: string) {
    for (const subscription of await this.listLiveSubscriptions(customerId)) {
      if (
        !isByokPlan(subscription) ||
        subscription.cancel_at_period_end ||
        subscription.cancel_at != null ||
        !holdsBillingSubscription(mapStripeSubscriptionStatus(subscription.status))
      )
        continue;
      try {
        await this.request("POST", `/v1/subscriptions/${encodeURIComponent(subscription.id)}`, {
          cancel_at_period_end: true,
        });
      } catch (error) {
        await this.rethrowUnlessEnded(error, customerId, subscription.id);
      }
    }
  }

  private async monthlyPrice(
    lookupKey: string,
    amountCents: number,
    productName: string,
  ): Promise<string> {
    const cached = this.monthlyPrices.get(lookupKey);
    if (cached) return cached;
    const id = await this.findOrCreatePrice({
      lookupKey,
      amountCents,
      currency: CREDIT_CURRENCY,
      interval: "month",
      productName,
    });
    this.monthlyPrices.set(lookupKey, id);
    return id;
  }

  /** The active price with this lookup key, amount, currency and interval, else a new one that takes the key. */
  private async findOrCreatePrice(input: {
    lookupKey: string;
    amountCents: number;
    currency: string;
    interval: BillingInterval;
    productName: string;
    metadata?: Record<string, string>;
  }): Promise<string> {
    const query = encodeStripeForm({
      active: true,
      lookup_keys: [input.lookupKey],
      expand: ["data.product"],
    });
    const prices = z
      .object({
        data: z.array(
          idSchema.merge(priceSchema).extend({
            product: z.object({ active: z.boolean() }),
          }),
        ),
      })
      .parse(await this.request("GET", `/v1/prices?${query}`));
    const existing = prices.data.find(
      (price) =>
        price.product.active &&
        price.currency === input.currency &&
        price.unit_amount === input.amountCents &&
        price.recurring.interval === input.interval &&
        price.recurring.interval_count === 1,
    );
    if (existing) return existing.id;
    // Checkout's inline products are archived automatically; reusable plans need active products.
    return idSchema.parse(
      await this.request("POST", "/v1/prices", {
        currency: input.currency,
        unit_amount: input.amountCents,
        recurring: { interval: input.interval },
        product_data: { name: input.productName },
        lookup_key: input.lookupKey,
        transfer_lookup_key: true,
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }),
    ).id;
  }

  /** Every catalog price, by lookup key. */
  private catalogPrices() {
    const prices: Array<{
      lookupKey: string;
      amountCents: number;
      currency: BillingCurrency;
      interval: BillingInterval;
      productName: string;
      metadata?: Record<string, string>;
    }> = [];
    for (const currency of BILLING_CURRENCIES) {
      for (const interval of BILLING_INTERVALS) {
        for (const plan of PLAN_IDS)
          prices.push({
            lookupKey: planLookupKey(plan, currency, interval),
            amountCents: planPriceCents(plan, currency, interval),
            currency,
            interval,
            productName: `Rook ${plan}`,
          });
        prices.push({
          lookupKey: extraPersonLookupKey(currency, interval),
          amountCents: extraPersonCents(currency, interval),
          currency,
          interval,
          productName: "Rook extra person",
        });
        prices.push({
          lookupKey: extraComputerLookupKey(currency, interval),
          amountCents: extraComputerCents(currency, interval),
          currency,
          interval,
          productName: "Rook extra computer",
        });
        for (const useCents of AI_USE_CENTS)
          prices.push({
            lookupKey: aiLookupKey(useCents, currency, interval),
            amountCents: aiAddOnPriceCents(currency, useCents, interval),
            currency,
            interval,
            productName: "Rook AI use",
            metadata: { [CREDIT_USE_METADATA]: String(aiUseGrantCents(useCents, interval)) },
          });
      }
    }
    return prices;
  }

  async ensurePlanPrices(): Promise<Record<string, string>> {
    const ids: Record<string, string> = {};
    for (const price of this.catalogPrices()) {
      const id = await this.findOrCreatePrice(price);
      this.catalogPriceIds.set(price.lookupKey, id);
      ids[price.lookupKey] = id;
    }
    return ids;
  }

  async priceIdForLookupKey(key: string): Promise<string | null> {
    const cached = this.catalogPriceIds.get(key);
    if (cached) return cached;
    const query = encodeStripeForm({ active: true, lookup_keys: [key] });
    const found = z
      .object({ data: z.array(idSchema) })
      .parse(await this.request("GET", `/v1/prices?${query}`)).data[0];
    if (found) this.catalogPriceIds.set(key, found.id);
    return found?.id ?? null;
  }

  /** The id of a catalog price, creating it first when this Stripe account does not have it yet. */
  private async catalogPriceId(lookupKey: string): Promise<string> {
    const cached = this.catalogPriceIds.get(lookupKey);
    if (cached) return cached;
    const price = this.catalogPrices().find((candidate) => candidate.lookupKey === lookupKey);
    if (!price) throw new Error(`Unknown catalog price ${lookupKey}`);
    const id = await this.findOrCreatePrice(price);
    this.catalogPriceIds.set(lookupKey, id);
    return id;
  }

  async createPlanCheckout(input: BillingPlanCheckoutRequest) {
    await this.expireOpenCheckouts(input.customerId);
    // With no open session left, a checkout that completed meanwhile has left its subscription.
    if (
      (await this.listSubscriptions(input.customerId)).some((s) =>
        holdsBillingSubscription(mapStripeSubscriptionStatus(s.status)),
      )
    )
      throw new BillingCheckoutCompletedError();
    const lineItems = (await this.selectionItems(input)).map(({ price, quantity }) => ({
      price,
      quantity,
    }));
    const session = urlSchema.parse(
      await this.request("POST", "/v1/checkout/sessions", {
        customer: input.customerId,
        mode: "subscription",
        allowed_payment_method_types: ["card"],
        adaptive_pricing: { enabled: false },
        allow_promotion_codes: true,
        ...termsConsent(input.termsVersion),
        line_items: lineItems,
        subscription_data: { billing_mode: { type: "classic" } },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      }),
    );
    return { url: session.url };
  }

  /** The lines a plan holds, with the catalog price id of each. */
  private async selectionItems(selection: BillingPlanSelection) {
    const { currency, interval } = selection;
    const items: Array<{ kind: ItemKind; price: string; quantity: number }> = [
      {
        kind: "plan",
        price: await this.catalogPriceId(planLookupKey(selection.plan, currency, interval)),
        quantity: 1,
      },
    ];
    if (selection.extraPeople > 0)
      items.push({
        kind: "extra",
        price: await this.catalogPriceId(extraPersonLookupKey(currency, interval)),
        quantity: selection.extraPeople,
      });
    if (selection.extraComputers)
      items.push({
        kind: "computer",
        price: await this.catalogPriceId(extraComputerLookupKey(currency, interval)),
        quantity: selection.extraComputers,
      });
    if (selection.aiUseCents)
      items.push({
        kind: "ai",
        price: await this.catalogPriceId(aiLookupKey(selection.aiUseCents, currency, interval)),
        quantity: 1,
      });
    return items;
  }

  async changePlan(input: BillingPlanChangeRequest) {
    const chosen = pickStripeSubscription(await this.listLiveSubscriptions(input.customerId));
    if (!chosen || !holdsBillingSubscription(chosen.status))
      throw new Error("No subscription to change");
    let subscription = chosen.subscription;
    // A waiting change is replaced, and a subscription under a schedule cannot be edited freely.
    if (subscription.schedule) await this.releaseSchedule(subscription.schedule);
    if (input.apply) {
      subscription = await this.applySelection(subscription, input.apply);
    }
    if (input.atRenewal) await this.scheduleSelection(subscription, input.atRenewal);
  }

  private async releaseSchedule(scheduleId: string) {
    try {
      await this.request(
        "POST",
        `/v1/subscription_schedules/${encodeURIComponent(scheduleId)}/release`,
      );
    } catch (error) {
      // Already released or completed: nothing is left to hold the subscription.
      if (!(error instanceof StripeRequestError && error.type === "invalid_request_error"))
        throw error;
    }
  }

  /** Swaps the subscription's lines for the selection's now, charging the difference for the period. */
  private async applySelection(
    subscription: StripeSubscription,
    selection: BillingPlanSelection,
  ): Promise<StripeSubscription> {
    const wanted = await this.selectionItems(selection);
    const base = baseItem(subscription);
    const taken = new Set<ItemKind>();
    const items: Array<Record<string, unknown>> = [];
    for (const item of subscription.items.data) {
      const kind = itemKind(item, base);
      const want = kind && !taken.has(kind) ? wanted.find((w) => w.kind === kind) : undefined;
      if (!want) {
        items.push({ id: item.id, deleted: true });
        continue;
      }
      taken.add(want.kind);
      if (item.price.id !== want.price || item.quantity !== want.quantity)
        items.push({ id: item.id, price: want.price, quantity: want.quantity });
    }
    for (const want of wanted)
      if (!taken.has(want.kind)) items.push({ price: want.price, quantity: want.quantity });
    // Credits and the own-key plan are marked on the subscription; a plan is neither.
    const cleared = ["corvo_credit_cents", BYOK_PLAN_METADATA].filter(
      (key) => subscription.metadata?.[key],
    );
    try {
      return subscriptionSchema.parse(
        await this.request("POST", `/v1/subscriptions/${encodeURIComponent(subscription.id)}`, {
          items,
          ...(cleared.length
            ? { metadata: Object.fromEntries(cleared.map((key) => [key, ""])) }
            : {}),
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
        }),
      );
    } catch (error) {
      if (
        error instanceof StripeRequestError &&
        (error.type === "card_error" ||
          error.code === "subscription_payment_intent_requires_action")
      )
        throw new BillingPaymentRequiredError();
      throw error;
    }
  }

  /** Holds the subscription as it is until its period ends, then moves it to the selection. */
  private async scheduleSelection(
    subscription: StripeSubscription,
    selection: BillingPlanSelection,
  ) {
    const schedule = scheduleSchema.parse(
      await this.request("POST", "/v1/subscription_schedules", {
        from_subscription: subscription.id,
      }),
    );
    const current = schedule.phases[0];
    if (!current?.end_date) throw new Error("Subscription schedule has no current phase");
    const next = await this.selectionItems(selection);
    await this.request("POST", `/v1/subscription_schedules/${encodeURIComponent(schedule.id)}`, {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: {
        [PENDING_PLAN_METADATA]: planLookupKey(
          selection.plan,
          selection.currency,
          selection.interval,
        ),
        [PENDING_AI_METADATA]: String(selection.aiUseCents ?? 0),
      },
      phases: [
        {
          start_date: current.start_date,
          end_date: current.end_date,
          items: current.items.map((item) => ({ price: item.price, quantity: item.quantity })),
        },
        {
          items: next.map(({ price, quantity }) => ({ price, quantity })),
          iterations: 1,
          billing_cycle_anchor: "phase_start",
        },
      ],
    });
  }

  /** What a schedule of this adapter's still has waiting; null once its phase has begun. */
  private pendingFromSchedule(
    schedule: StripeSchedule,
  ): BillingSubscriptionSnapshot["pendingChange"] {
    const key = schedule.metadata?.[PENDING_PLAN_METADATA];
    const waiting =
      schedule.phases.length >= 2 &&
      schedule.current_phase?.start_date === schedule.phases[0]?.start_date;
    if (!key || !waiting) return undefined;
    const ai = Number(schedule.metadata?.[PENDING_AI_METADATA]);
    return {
      priceLookupKey: key,
      aiUseCents: AI_USE_CENTS.find((cents) => cents === ai) ?? null,
    };
  }

  /** Re-read settled payments and refund state; webhook payloads never grant money directly. */
  async listCreditPurchases(customerId: string): Promise<BillingCreditPurchase[]> {
    const customer = encodeURIComponent(customerId);
    const chargeSchema = z.object({
      id: z.string(),
      payment_intent: z.string().nullable(),
      currency: z.string(),
      paid: z.boolean(),
      captured: z.boolean(),
      disputed: z.boolean(),
      amount: z.number().int(),
      amount_refunded: z.number().int(),
    });
    const chargesPromise = this.listPages(`/v1/charges?customer=${customer}`, chargeSchema);
    const metadata = z.record(z.string(), z.string());
    const sessionsPromise = this.listPages(
      `/v1/checkout/sessions?customer=${customer}&status=complete`,
      z.object({
        id: z.string(),
        mode: z.string(),
        payment_status: z.string(),
        currency: z.string().nullable(),
        amount_total: z.number().nullable(),
        payment_intent: z.string().nullable(),
        metadata,
      }),
    );
    const creditLineSchema = z.object({
      amount: z.number().int(),
      quantity: z.number().int().nullish(),
      pricing: z
        .object({ price_details: z.object({ price: z.string().optional() }).nullish() })
        .nullish(),
      discount_amounts: z.array(z.object({ amount: z.number().int().nonnegative() })).nullish(),
      period: z.object({ end: z.number().int().positive() }),
      parent: z
        .object({
          type: z.string(),
          subscription_item_details: z.object({ subscription: z.string() }).nullable().optional(),
        })
        .nullable()
        .optional(),
    });
    const invoicesPromise = this.listPages(
      `/v1/invoices?customer=${customer}&status=paid`,
      z.object({
        id: z.string(),
        currency: z.string(),
        amount_paid: z.number().int(),
        billing_reason: z.string().nullable(),
        lines: z
          .object({ data: z.array(creditLineSchema), has_more: z.boolean().optional() })
          .optional(),
        parent: z
          .object({
            subscription_details: z
              .object({ metadata, subscription: z.string().optional() })
              .nullable()
              .optional(),
          })
          .nullable()
          .optional(),
      }),
    );
    const [charges, sessions, invoices] = await Promise.all([
      chargesPromise,
      sessionsPromise,
      invoicesPromise,
    ]);
    // What each payment still keeps after refunds and disputes, in the currency it was charged in.
    // A purchase counts only payments in its own currency.
    const netPaid = new Map<string, { currency: string; cents: number }>();
    for (const charge of charges) {
      if (!charge.payment_intent || !charge.paid || !charge.captured) continue;
      const previous = netPaid.get(charge.payment_intent);
      if (previous && previous.currency !== charge.currency) continue;
      netPaid.set(charge.payment_intent, {
        currency: charge.currency,
        cents:
          (previous?.cents ?? 0) +
          (charge.disputed ? 0 : Math.max(0, charge.amount - charge.amount_refunded)),
      });
    }
    const paidIn = (paymentIntent: string | undefined, currency: string) => {
      const payment = netPaid.get(paymentIntent ?? "");
      return payment?.currency === currency ? payment.cents : 0;
    };
    const purchases: BillingCreditPurchase[] = [];
    for (const session of sessions) {
      const amount = creditAmount(session.metadata.corvo_credit_cents);
      if (
        session.mode !== "payment" ||
        session.payment_status !== "paid" ||
        session.currency !== CREDIT_CURRENCY ||
        !amount ||
        session.amount_total !== amount ||
        !session.payment_intent
      )
        continue;
      purchases.push({
        id: session.id,
        amountCents: Math.min(amount, paidIn(session.payment_intent, session.currency)),
      });
    }
    for (const invoice of invoices) {
      const packAmount = creditAmount(
        invoice.parent?.subscription_details?.metadata.corvo_credit_cents,
      );
      // Monthly credit packs are sold in dollars; plan invoices in any catalog currency.
      const currencyOk = packAmount
        ? invoice.currency === CREDIT_CURRENCY
        : (BILLING_CURRENCIES as readonly string[]).includes(invoice.currency);
      if (
        !currencyOk ||
        !["subscription_create", "subscription_cycle", "subscription_update"].includes(
          invoice.billing_reason ?? "",
        ) ||
        invoice.amount_paid <= 0
      )
        continue;
      const [payments, lines] = await Promise.all([
        this.listPages(
          `/v1/invoice_payments?invoice=${encodeURIComponent(invoice.id)}&status=paid`,
          z.object({ payment: z.object({ payment_intent: z.string().optional() }) }),
        ),
        invoice.lines && !invoice.lines.has_more
          ? Promise.resolve(invoice.lines.data)
          : this.listPages(
              `/v1/invoices/${encodeURIComponent(invoice.id)}/lines`,
              creditLineSchema,
            ),
      ]);
      const paid = payments.reduce(
        (sum, payment) => sum + paidIn(payment.payment.payment_intent, invoice.currency),
        0,
      );
      const subscriptionLines = lines.filter(
        (line) =>
          line.parent?.type === "subscription_item_details" &&
          Boolean(invoice.parent?.subscription_details?.subscription) &&
          line.parent.subscription_item_details?.subscription ===
            invoice.parent?.subscription_details?.subscription,
      );
      // Credits come from the packs, or from the AI add-on lines of a plan; a plan without
      // the add-on grants none.
      let useCents: number | undefined;
      let periods = subscriptionLines;
      const infos = await Promise.all(
        subscriptionLines.map((line) => this.priceInfo(line.pricing?.price_details?.price)),
      );
      if (!packAmount) {
        // Each AI line grants its use in proportion to what the line charged: a whole period
        // charges the whole price, a change part-way through a period only the share left, and
        // the unused part of the line it replaces is taken back. Credit never exceeds the money.
        let granted = 0n;
        const withUse: typeof subscriptionLines = [];
        subscriptionLines.forEach((line, index) => {
          const info = infos[index]!;
          if (info.use <= 0 || info.unitAmount <= 0) return;
          granted += floorDiv(BigInt(info.use) * BigInt(line.amount), BigInt(info.unitAmount));
          withUse.push(line);
        });
        if (granted <= 0n) continue;
        useCents = Number(granted);
        periods = withUse;
      } else {
        // A plan change swaps these lines on a subscription that was a credit pack; the plan's
        // lines are not the pack's credit.
        periods = subscriptionLines.filter((_, index) => !infos[index]!.catalog);
        if (!periods.length) continue;
      }
      if (!periods.length) throw new Error("Monthly credit invoice has no service period");
      const expiresAt = fromSeconds(
        Math.max(...periods.map((line) => line.period.end)),
      )!.toISOString();
      const settled = Math.min(paid, invoice.amount_paid);
      let amountCents: number;
      if (useCents !== undefined) {
        // The table dollars, shrunk by the share of the invoice no longer paid; never converted.
        amountCents = Number((BigInt(useCents) * BigInt(settled)) / BigInt(invoice.amount_paid));
      } else {
        const creditAmountCents = Math.max(
          0,
          periods.reduce(
            (sum, line) =>
              sum +
              line.amount -
              (line.discount_amounts ?? []).reduce((discount, item) => discount + item.amount, 0),
            0,
          ),
        );
        // Credits cover the subscription lines, excluding tax and other items. Refunds
        // reduce that paid portion proportionally because charges do not identify a line.
        amountCents = Number(
          (BigInt(Math.min(creditAmountCents, invoice.amount_paid)) * BigInt(settled)) /
            BigInt(invoice.amount_paid),
        );
      }
      purchases.push({
        id: invoice.id,
        amountCents,
        ...(useCents === undefined ? {} : { useCents }),
        expiresAt,
      });
    }
    return purchases;
  }

  /** What a price says about credit: the use one unit buys, its unit amount, and whether it is a catalog price. */
  private async priceInfo(
    priceId: string | undefined,
  ): Promise<{ use: number; unitAmount: number; catalog: boolean }> {
    if (!priceId) return { use: 0, unitAmount: 0, catalog: false };
    const cached = this.priceInfos.get(priceId);
    if (cached) return cached;
    const price = z
      .object({
        metadata: z.record(z.string(), z.string()).nullish(),
        unit_amount: z.number().int().nullish(),
        lookup_key: z.string().nullish(),
      })
      .parse(await this.request("GET", `/v1/prices/${encodeURIComponent(priceId)}`));
    const parsed = Number(price.metadata?.[CREDIT_USE_METADATA]);
    const info = {
      use: Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0,
      unitAmount: price.unit_amount ?? 0,
      catalog: /^(plan_|extra_person_|ai_)/.test(price.lookup_key ?? ""),
    };
    this.priceInfos.set(priceId, info);
    return info;
  }

  private async listPages<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const rows: T[] = [];
    let after: string | undefined;
    for (;;) {
      const query = encodeStripeForm({ limit: 100, starting_after: after });
      const page = z
        .object({ data: z.array(schema.and(idSchema)), has_more: z.boolean() })
        .parse(await this.request("GET", `${path}${path.includes("?") ? "&" : "?"}${query}`));
      rows.push(...page.data);
      if (!page.has_more || !page.data.length) return rows;
      after = page.data.at(-1)!.id;
    }
  }

  async createPortal(input: { customerId: string; returnUrl: string }) {
    const session = urlSchema.parse(
      await this.request("POST", "/v1/billing_portal/sessions", {
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    );
    return { url: session.url };
  }

  async getCustomerSubscription(customerId: string): Promise<BillingSubscriptionSnapshot | null> {
    const chosen = pickStripeSubscription(await this.listLiveSubscriptions(customerId));
    if (!chosen) return null;
    const snapshot = toSnapshot(chosen.subscription, chosen.status);
    if (!chosen.subscription.schedule || !holdsBillingSubscription(chosen.status)) return snapshot;
    const schedule = scheduleSchema.parse(
      await this.request(
        "GET",
        `/v1/subscription_schedules/${encodeURIComponent(chosen.subscription.schedule)}`,
      ),
    );
    const pendingChange = this.pendingFromSchedule(schedule);
    return pendingChange ? { ...snapshot, pendingChange } : snapshot;
  }

  async updateSeats(customerId: string, seats: number) {
    // Ended subscriptions refuse updates, as do incomplete ones from Checkout. Unpaid and paused
    // ones accept them, so they resume with the right seats.
    for (;;) {
      const chosen = pickStripeSubscription(await this.listLiveSubscriptions(customerId));
      if (!chosen || !holdsBillingSubscription(chosen.status)) return;
      if (
        creditAmount(chosen.subscription.metadata?.corvo_credit_cents) ||
        isByokPlan(chosen.subscription)
      )
        return;
      const item = baseItem(chosen.subscription);
      if (!item || item.quantity === seats) return;
      if (chosen.subscription.schedule) await this.releaseSchedule(chosen.subscription.schedule);
      try {
        await this.request("POST", `/v1/subscription_items/${encodeURIComponent(item.id)}`, {
          quantity: seats,
          proration_behavior: "create_prorations",
        });
        return;
      } catch (error) {
        await this.rethrowUnlessEnded(error, customerId, chosen.subscription.id);
      }
    }
  }

  async setExtraSeats(customerId: string, input: { priceId: string; quantity: number }) {
    await this.setExtraLine(customerId, input, "corvo_extra_seats");
  }

  async setExtraComputers(customerId: string, input: { priceId: string; quantity: number }) {
    await this.setExtraLine(customerId, input, "corvo_extra_computers", true);
  }

  /** Sets the quantity of an extra line (seats or computers) at `input.priceId`. */
  private async setExtraLine(
    customerId: string,
    input: { priceId: string; quantity: number },
    marker: "corvo_extra_seats" | "corvo_extra_computers",
    chargeNow = false,
  ) {
    const proration = chargeNow ? "always_invoice" : "create_prorations";
    for (;;) {
      const chosen = pickStripeSubscription(await this.listLiveSubscriptions(customerId));
      if (!chosen || !holdsBillingSubscription(chosen.status)) return;
      if (
        creditAmount(chosen.subscription.metadata?.corvo_credit_cents) ||
        isByokPlan(chosen.subscription)
      )
        return;
      const extra = chosen.subscription.items.data.find((item) => item.price.id === input.priceId);
      if (chosen.subscription.schedule && (extra?.quantity ?? 0) !== input.quantity)
        await this.releaseSchedule(chosen.subscription.schedule);
      try {
        if (!extra) {
          if (input.quantity < 1) return;
          await this.request("POST", "/v1/subscription_items", {
            subscription: chosen.subscription.id,
            price: input.priceId,
            quantity: input.quantity,
            metadata: { [marker]: "1" },
            proration_behavior: proration,
            ...(chargeNow ? { payment_behavior: "error_if_incomplete" } : {}),
          });
        } else if (input.quantity < 1) {
          await this.request(
            "DELETE",
            `/v1/subscription_items/${encodeURIComponent(extra.id)}?proration_behavior=${proration}`,
          );
        } else if (extra.quantity !== input.quantity) {
          await this.request("POST", `/v1/subscription_items/${encodeURIComponent(extra.id)}`, {
            quantity: input.quantity,
            proration_behavior: proration,
            ...(chargeNow ? { payment_behavior: "error_if_incomplete" } : {}),
          });
        }
        return;
      } catch (error) {
        if (
          chargeNow &&
          error instanceof StripeRequestError &&
          (error.type === "card_error" ||
            error.code === "subscription_payment_intent_requires_action")
        )
          throw new BillingPaymentRequiredError();
        await this.rethrowUnlessEnded(error, customerId, chosen.subscription.id);
      }
    }
  }

  async cancelCustomerSubscriptions(customerId: string) {
    // First, so an abandoned checkout cannot start a subscription after the cancel.
    await this.expireOpenCheckouts(customerId).catch(ignoreDeletedCustomer);
    for (const subscription of await this.listLiveSubscriptions(customerId)) {
      // Only terminal states; unpaid and paused subscriptions can still resume and charge.
      if (mapStripeSubscriptionStatus(subscription.status) === "canceled") continue;
      try {
        await this.request("DELETE", `/v1/subscriptions/${encodeURIComponent(subscription.id)}`);
      } catch (error) {
        await this.rethrowUnlessEnded(error, customerId, subscription.id);
      }
    }
  }

  parseWebhook(rawBody: string, headers: Headers) {
    return parseStripeWebhook(this.config.webhookSecret, rawBody, headers, this.now());
  }

  private async expireOpenCheckouts(customerId: string): Promise<void> {
    const seen = new Set<string>();
    for (;;) {
      const query = encodeStripeForm({ customer: customerId, status: "open", limit: 100 });
      const page = checkoutListSchema.parse(
        await this.request("GET", `/v1/checkout/sessions?${query}`),
      );
      const fresh = page.data.filter((session) => !seen.has(session.id));
      if (fresh.length === 0) return;
      for (const session of fresh) {
        seen.add(session.id);
        try {
          await this.request(
            "POST",
            `/v1/checkout/sessions/${encodeURIComponent(session.id)}/expire`,
          );
        } catch (error) {
          // No longer open: it expired on its own or was just paid, which the caller rechecks.
          if (!(error instanceof StripeRequestError && error.type === "invalid_request_error"))
            throw error;
        }
      }
    }
  }

  /** A write Stripe refused because the subscription ended since it was read has nothing left to do. */
  private async rethrowUnlessEnded(error: unknown, customerId: string, subscriptionId: string) {
    if (!(error instanceof StripeRequestError && error.type === "invalid_request_error"))
      throw error;
    const fresh = (await this.listLiveSubscriptions(customerId)).find(
      (s) => s.id === subscriptionId,
    );
    if (fresh && mapStripeSubscriptionStatus(fresh.status) !== "canceled") throw error;
  }

  /** Deleting a customer cancels its subscriptions, so a deleted one has none left. */
  private listLiveSubscriptions(customerId: string): Promise<StripeSubscription[]> {
    return this.listSubscriptions(customerId).catch((error: unknown) => {
      ignoreDeletedCustomer(error);
      return [];
    });
  }

  private async listSubscriptions(customerId: string): Promise<StripeSubscription[]> {
    const all: StripeSubscription[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const query = encodeStripeForm({
        customer: customerId,
        status: "all",
        limit: 100,
        starting_after: startingAfter,
      });
      const page = subscriptionListSchema.parse(
        await this.request("GET", `/v1/subscriptions?${query}`),
      );
      all.push(...page.data);
      const last = page.data.at(-1);
      if (!page.has_more || !last) return all;
      startingAfter = last.id;
    }
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params?: Record<string, unknown> | string,
  ): Promise<unknown> {
    try {
      return await this.http.request(method, path, params);
    } catch (error) {
      if (
        error instanceof StripeRequestError &&
        error.code === "resource_missing" &&
        error.param === "customer"
      )
        throw new BillingCustomerNotFoundError();
      throw error;
    }
  }
}

function ignoreDeletedCustomer(error: unknown): void {
  if (!(error instanceof BillingCustomerNotFoundError)) throw error;
}

/** Stripe statuses collapse onto the provider-neutral set; `incomplete_expired` is terminal. */
export function mapStripeSubscriptionStatus(status: string): BillingSubscriptionStatus {
  if (
    status === "trialing" ||
    status === "active" ||
    status === "past_due" ||
    status === "incomplete" ||
    status === "unpaid" ||
    status === "paused"
  )
    return status;
  return "canceled";
}

/**
 * Prefers the newest subscription that grants access, then one that can still resume and charge
 * (so a later ended one cannot hide it), else the newest overall.
 */
export function pickBillingSubscription<
  T extends { status: BillingSubscriptionStatus; created: number },
>(subscriptions: T[]): T | undefined {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created);
  return (
    newestFirst.find((s) => grantsAccess(s.status)) ??
    newestFirst.find((s) => holdsBillingSubscription(s.status)) ??
    newestFirst[0]
  );
}

function pickStripeSubscription(subscriptions: StripeSubscription[]) {
  return pickBillingSubscription(
    subscriptions.map((subscription) => ({
      subscription,
      status: mapStripeSubscriptionStatus(subscription.status),
      created: subscription.created,
    })),
  );
}

function grantsAccess(status: BillingSubscriptionStatus) {
  return status === "trialing" || status === "active" || status === "past_due";
}

/** Grants access now or resumes once paid, so another checkout would bill twice. */
export function holdsBillingSubscription(status: BillingSubscriptionStatus) {
  return grantsAccess(status) || status === "unpaid" || status === "paused";
}

/** The plan's own line: the one that is not an extra-seat line this adapter added. */
function baseItem(subscription: StripeSubscription) {
  const items = subscription.items.data;
  return (
    // A plan checkout puts the plan, extra people and AI on one subscription in no fixed order.
    items.find((item) => item.price.lookup_key?.startsWith("plan_")) ??
    items.find(
      (item) =>
        !item.metadata?.corvo_extra_seats &&
        !item.metadata?.corvo_extra_computers &&
        !item.price.lookup_key?.startsWith("extra_person_") &&
        !item.price.lookup_key?.startsWith("extra_computer_") &&
        !item.price.lookup_key?.startsWith("ai_"),
    ) ??
    items[0]
  );
}

type ItemKind = "plan" | "extra" | "computer" | "ai";

/** Which of a plan's lines an item is; null for one that belongs to no plan. */
function itemKind(
  item: StripeSubscription["items"]["data"][number],
  base: StripeSubscription["items"]["data"][number] | undefined,
): ItemKind | null {
  const key = item.price.lookup_key;
  if (key?.startsWith("plan_") || item === base) return "plan";
  if (key?.startsWith("extra_computer_") || item.metadata?.corvo_extra_computers) return "computer";
  if (key?.startsWith("extra_person_") || item.metadata?.corvo_extra_seats) return "extra";
  if (key?.startsWith("ai_")) return "ai";
  return null;
}

function toSnapshot(
  subscription: StripeSubscription,
  status: BillingSubscriptionStatus,
): BillingSubscriptionSnapshot {
  const item = baseItem(subscription);
  if (!item) throw new Error("Stripe subscription has no items");
  const aiUseCents = parseAiLookupKey(
    subscription.items.data.find((line) => line.price.lookup_key?.startsWith("ai_"))?.price
      .lookup_key,
  );
  const aiUse = aiUseCents ? { aiUseCents } : {};
  const extraComputers =
    subscription.items.data.find(
      (line) =>
        line.price.lookup_key?.startsWith("extra_computer_") ||
        line.metadata?.corvo_extra_computers,
    )?.quantity ?? 0;
  return {
    creditAmountCents: creditAmount(subscription.metadata?.corvo_credit_cents),
    subscriptionId: subscription.id,
    subscriptionItemId: item.id,
    priceId: item.price.id,
    ...(item.price.lookup_key ? { priceLookupKey: item.price.lookup_key } : {}),
    status,
    seats: item.quantity ?? 1,
    trialEndsAt: fromSeconds(subscription.trial_end),
    currentPeriodEndsAt: fromSeconds(item.current_period_end ?? subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end) || subscription.cancel_at != null,
    endedAt: fromSeconds(subscription.ended_at),
    ...(isByokPlan(subscription) ? { byokPlan: true } : {}),
    ...aiUse,
    ...(extraComputers > 0 ? { extraComputers } : {}),
  };
}

/** Integer division that rounds toward negative infinity, so a taken-back share is never rounded away. */
function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n
    ? quotient - 1n
    : quotient;
}

function fromSeconds(value: number | null | undefined) {
  return value == null ? null : new Date(value * 1000);
}

const syncEventTypes = new Set([
  "checkout.session.completed",
  "customer.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "checkout.session.async_payment_succeeded",
  "charge.refunded",
  "charge.dispute.created",
  "charge.dispute.closed",
]);

type StripeObject = Record<string, unknown>;

/** Paying means accepting the terms; the webhook stores the acceptance as evidence. */
function termsConsent(termsVersion: string | undefined, metadata: Record<string, string> = {}) {
  return {
    consent_collection: { terms_of_service: "required" },
    metadata: { ...metadata, ...(termsVersion ? { terms_version: termsVersion } : {}) },
  };
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const whole = (value: unknown) => (typeof value === "number" ? value : undefined);
/** An expandable reference: the id, or the object that carries one. */
const refId = (value: unknown) => text(value) ?? text((value as StripeObject | undefined)?.id);

/** The facts a verified event carries about what was charged, accepted or disputed. */
function stripeEvidence(
  event: { id?: unknown; type?: unknown; created?: unknown },
  object: StripeObject | undefined,
): BillingEvidence | undefined {
  const eventId = text(event.id);
  const created = whole(event.created);
  if (!eventId || created === undefined || !object) return undefined;
  const kind = text(object.object);
  const lines =
    (object.lines as { data?: StripeObject[] } | undefined)?.data ??
    (object.items as { data?: StripeObject[] } | undefined)?.data ??
    [];
  const prices = lines.map((line) => (line.price ?? {}) as StripeObject);
  const keys = prices.flatMap((price) => text(price.lookup_key) ?? []);
  const interval = prices
    .map((price) => text((price.recurring as StripeObject | undefined)?.interval))
    .find(Boolean);
  const terms = text((object.consent as StripeObject | undefined)?.terms_of_service);
  const metadata = object.metadata as StripeObject | undefined;
  const fields: Omit<BillingEvidence, "eventId" | "type" | "occurredAt"> = {
    ...(kind === "checkout.session" ? { sessionId: text(object.id) } : {}),
    ...(kind === "invoice" ? { invoiceId: text(object.id) } : {}),
    ...(kind === "charge" ? { chargeId: text(object.id) } : {}),
    ...(kind === "dispute" ? { chargeId: refId(object.charge) } : {}),
    ...(kind === "subscription" ? { subscriptionId: text(object.id) } : {}),
    ...(kind !== "subscription" && object.subscription
      ? { subscriptionId: refId(object.subscription) }
      : {}),
    ...(kind === "invoice" && object.charge ? { chargeId: refId(object.charge) } : {}),
    amountMinor:
      whole(object.amount_total) ??
      whole(object.amount_paid) ??
      whole(object.amount_due) ??
      (kind === "charge" && whole(object.amount_refunded)
        ? whole(object.amount_refunded)
        : whole(object.amount)),
    currency: text(object.currency),
    ...(keys.length ? { priceLookupKeys: keys } : {}),
    interval,
    ...(kind === "subscription" || kind === "dispute" ? { status: text(object.status) } : {}),
    ...(terms ? { termsAccepted: terms === "accepted" } : {}),
    termsVersion: text(metadata?.terms_version),
  };
  return {
    eventId,
    type: text(event.type) ?? "",
    occurredAt: new Date(created * 1000),
    ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
  };
}

/** Verifies a Stripe-signed webhook and extracts the customer to re-sync, plus its evidence. */
export function parseStripeWebhook(
  secret: string,
  rawBody: string,
  headers: Headers,
  nowMs: number,
): { customerId: string; evidence?: BillingEvidence } | "ignored" | null {
  if (!verifyStripeSignature(secret, rawBody, headers, nowMs)) return null;

  let event: {
    id?: unknown;
    type?: unknown;
    created?: unknown;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return "ignored";
  }
  const type = typeof event?.type === "string" ? event.type : "";
  if (!syncEventTypes.has(type) && !type.startsWith("customer.subscription.")) return "ignored";
  const object = event.data?.object;
  const customer = object?.object === "customer" ? object.id : object?.customer;
  const customerId =
    typeof customer === "string"
      ? customer
      : typeof (customer as { id?: unknown } | undefined)?.id === "string"
        ? (customer as { id: string }).id
        : undefined;
  if (!customerId) return "ignored";
  const evidence = stripeEvidence(event, object);
  return evidence ? { customerId, evidence } : { customerId };
}

export function stripeBillingConfigFromEnv(env: {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripePriceId?: string;
}): StripeBillingConfig | undefined {
  const values = {
    STRIPE_SECRET_KEY: env.stripeSecretKey?.trim(),
    STRIPE_WEBHOOK_SECRET: env.stripeWebhookSecret?.trim(),
    STRIPE_PRICE_ID: env.stripePriceId?.trim(),
  };
  if (!Object.values(values).some(Boolean)) return undefined;
  const missing = Object.entries(values)
    .filter(([name, value]) => name !== "STRIPE_PRICE_ID" && !value)
    .map(([name]) => name);
  if (missing.length)
    throw new Error(`Stripe billing is partially configured; set ${missing.join(", ")}`);
  return {
    secretKey: values.STRIPE_SECRET_KEY!,
    webhookSecret: values.STRIPE_WEBHOOK_SECRET!,
    ...(values.STRIPE_PRICE_ID ? { priceId: values.STRIPE_PRICE_ID } : {}),
  };
}

const BYOK_PLAN_METADATA = "corvo_plan";
/** Credit packs and monthly credits are sold in dollars. */
const CREDIT_CURRENCY = "usd";
/** On an AI add-on price: the dollars of use, in cents, one charge of it buys. */
const CREDIT_USE_METADATA = "credit_use_cents";

function isByokPlan(subscription: StripeSubscription) {
  return subscription.metadata?.[BYOK_PLAN_METADATA] === "byok";
}

function creditAmount(value: string | undefined): number | undefined {
  const parsed = ModelCreditAmountSchema.safeParse(Number(value));
  return parsed.success ? parsed.data : undefined;
}
