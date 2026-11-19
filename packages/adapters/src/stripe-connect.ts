import type {
  ApplicationFeeRecord,
  ConnectedAccountStatus,
  NormalizedPaymentEvent,
  PaymentCheckoutBase,
  PaymentRefundResult,
  PaymentRemoteStatus,
  PaymentsProvider,
} from "@corvo/adapter-kit";
import { z } from "zod";
import { StripeHttp, verifyStripeSignature } from "./stripe-http.js";

export interface StripeConnectConfig {
  secretKey: string;
  /** Signs the events of connected accounts: a Connect endpoint has its own secret. */
  connectWebhookSecret: string;
  fetch?: typeof fetch;
  apiBase?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const idSchema = z.object({ id: z.string().min(1) });
const urlSchema = z.object({ url: z.string().min(1) });
const accountSchema = z.object({
  id: z.string(),
  charges_enabled: z.boolean().nullish(),
  payouts_enabled: z.boolean().nullish(),
  details_submitted: z.boolean().nullish(),
  requirements: z
    .object({
      currently_due: z.array(z.string()).nullish(),
      disabled_reason: z.string().nullish(),
    })
    .nullish(),
});
const refundSchema = z.object({ id: z.string(), amount: z.number().int() });
const feeListSchema = z.object({
  has_more: z.boolean(),
  data: z.array(
    z.object({
      id: z.string(),
      account: z.string(),
      currency: z.string(),
      amount: z.number().int(),
      amount_refunded: z.number().int(),
      created: z.number().int(),
    }),
  ),
});
const configurationListSchema = z.object({ data: z.array(idSchema) });

/** Stripe Connect behind the provider-neutral payments interface: direct charges, Rook's fee. */
export class StripePaymentsProvider implements PaymentsProvider {
  private readonly http: StripeHttp;
  private readonly now: () => number;
  private readonly portalConfigurations = new Map<string, string>();

  constructor(private readonly config: StripeConnectConfig) {
    this.http = new StripeHttp(config);
    this.now = config.now ?? Date.now;
  }

  describe() {
    return {
      id: "stripe-connect",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { connect: true, portal: true },
    };
  }

  async createConnectedAccount(input: {
    partnerId: string;
    country: string;
    email?: string;
    businessName: string;
  }) {
    const account = idSchema.parse(
      await this.http.request(
        "POST",
        "/v1/accounts",
        {
          type: "express",
          country: input.country,
          email: input.email,
          business_profile: { name: input.businessName },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { corvo_partner_id: input.partnerId },
        },
        // The same partner asking twice opens one account.
        { idempotencyKey: `corvo-connect-account-${input.partnerId}` },
      ),
    );
    return { account: account.id };
  }

  async createOnboardingLink(input: { account: string; returnUrl: string; refreshUrl: string }) {
    const link = urlSchema.parse(
      await this.http.request("POST", "/v1/account_links", {
        account: input.account,
        type: "account_onboarding",
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      }),
    );
    return { url: link.url };
  }

  async getAccountStatus(account: string): Promise<ConnectedAccountStatus> {
    return toAccountStatus(
      accountSchema.parse(
        await this.http.request("GET", `/v1/accounts/${encodeURIComponent(account)}`),
      ),
    );
  }

  async createDashboardLink(account: string) {
    const link = urlSchema.parse(
      await this.http.request("POST", `/v1/accounts/${encodeURIComponent(account)}/login_links`),
    );
    return { url: link.url };
  }

  async createSubscriptionCheckout(input: PaymentCheckoutBase) {
    const session = urlSchema.parse(
      await this.http.request(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "subscription",
          ...this.checkoutCommon(input, { recurring: true }),
          subscription_data: {
            // The only fee Stripe takes on a first invoice; later invoices get the exact amount.
            application_fee_percent: feePercent(input.applicationFeeMinor, input.amountMinor),
            metadata: input.metadata,
          },
        },
        { account: input.account },
      ),
    );
    return { url: session.url };
  }

  async createTopUpCheckout(input: PaymentCheckoutBase) {
    const session = urlSchema.parse(
      await this.http.request(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "payment",
          ...this.checkoutCommon(input, { recurring: false }),
          ...(input.customerRef ? {} : { customer_creation: "always" }),
          payment_intent_data: {
            application_fee_amount: input.applicationFeeMinor,
            metadata: input.metadata,
          },
        },
        { account: input.account },
      ),
    );
    return { url: session.url };
  }

  private checkoutCommon(input: PaymentCheckoutBase, options: { recurring: boolean }) {
    return {
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: input.amountMinor,
            product_data: { name: input.productName },
            ...(options.recurring ? { recurring: { interval: "month" } } : {}),
          },
        },
      ],
      ...(input.customerRef
        ? { customer: input.customerRef }
        : input.customerEmail
          ? { customer_email: input.customerEmail }
          : {}),
      metadata: input.metadata,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    };
  }

  async createCustomerPortal(input: { account: string; customerRef: string; returnUrl: string }) {
    const configuration = await this.portalConfiguration(input.account);
    const session = urlSchema.parse(
      await this.http.request(
        "POST",
        "/v1/billing_portal/sessions",
        {
          customer: input.customerRef,
          return_url: input.returnUrl,
          configuration,
        },
        { account: input.account },
      ),
    );
    return { url: session.url };
  }

  /**
   * The portal of the connected account lets a customer change the card, read invoices and cancel
   * at the period's end. Changing plan is not offered there: it goes through Rook, so the fee and
   * the credit stay consistent.
   */
  private async portalConfiguration(account: string): Promise<string> {
    const known = this.portalConfigurations.get(account);
    if (known) return known;
    const listed = configurationListSchema.parse(
      await this.http.request("GET", "/v1/billing_portal/configurations?limit=1", undefined, {
        account,
      }),
    );
    const existing = listed.data[0]?.id;
    const id =
      existing ??
      idSchema.parse(
        await this.http.request(
          "POST",
          "/v1/billing_portal/configurations",
          {
            business_profile: { headline: null },
            features: {
              payment_method_update: { enabled: true },
              invoice_history: { enabled: true },
              customer_update: { enabled: false },
              subscription_update: { enabled: false },
              subscription_cancel: { enabled: true, mode: "at_period_end" },
            },
          },
          { account, idempotencyKey: `corvo-portal-${account}` },
        ),
      ).id;
    this.portalConfigurations.set(account, id);
    return id;
  }

  async changeSubscriptionPlan(input: {
    account: string;
    subscriptionRef: string;
    currency: string;
    amountMinor: number;
    applicationFeeMinor: number;
    productName: string;
    metadata: Record<string, string>;
    proration: "now" | "none";
  }) {
    const path = `/v1/subscriptions/${encodeURIComponent(input.subscriptionRef)}`;
    const current = z
      .object({ items: z.object({ data: z.array(idSchema) }) })
      .parse(await this.http.request("GET", path, undefined, { account: input.account }));
    const item = current.items.data[0];
    if (!item) throw new Error("The subscription has no item");
    await this.http.request(
      "POST",
      path,
      {
        items: [
          {
            id: item.id,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              recurring: { interval: "month" },
              product_data: { name: input.productName },
            },
          },
        ],
        // An upgrade is charged now, so its credit is granted from that payment; a downgrade
        // only changes what the next period charges.
        proration_behavior: input.proration === "now" ? "always_invoice" : "none",
        application_fee_percent: feePercent(input.applicationFeeMinor, input.amountMinor),
        metadata: input.metadata,
      },
      { account: input.account },
    );
  }

  async setInvoiceApplicationFee(input: {
    account: string;
    invoiceRef: string;
    applicationFeeMinor: number;
  }) {
    await this.http.request(
      "POST",
      `/v1/invoices/${encodeURIComponent(input.invoiceRef)}`,
      { application_fee_amount: input.applicationFeeMinor },
      { account: input.account },
    );
  }

  async refund(input: {
    account: string;
    paymentRef: string;
    amountMinor?: number;
    key: string;
  }): Promise<PaymentRefundResult> {
    const refund = refundSchema.parse(
      await this.http.request(
        "POST",
        "/v1/refunds",
        {
          payment_intent: input.paymentRef,
          amount: input.amountMinor,
          // Rook's fee goes back in proportion; the partner is not left paying it.
          refund_application_fee: true,
        },
        { account: input.account, idempotencyKey: `corvo-refund-${input.key}` },
      ),
    );
    return { refundRef: refund.id, refundedMinor: refund.amount };
  }

  async refundApplicationFee(input: {
    applicationFeeRef: string;
    chargeAmountMinor: number;
    refundedMinor: number;
  }) {
    const path = `/v1/application_fees/${encodeURIComponent(input.applicationFeeRef)}`;
    const fee = z
      .object({ amount: z.number().int(), amount_refunded: z.number().int() })
      .parse(await this.http.request("GET", path));
    // The same rule as the ledger: a full refund returns all of the fee, a part its share, down.
    const target =
      input.refundedMinor >= input.chargeAmountMinor
        ? fee.amount
        : Number(
            (BigInt(fee.amount) * BigInt(input.refundedMinor)) / BigInt(input.chargeAmountMinor),
          );
    const owed = target - fee.amount_refunded;
    if (owed <= 0) return;
    await this.http.request(
      "POST",
      `${path}/refunds`,
      { amount: owed },
      { idempotencyKey: `corvo-fee-refund-${input.applicationFeeRef}-${input.refundedMinor}` },
    );
  }

  async trimApplicationFee(input: { account: string; paymentRef: string; targetFeeMinor: number }) {
    const intent = z
      .object({
        latest_charge: z
          .object({
            application_fee: z.string().nullish(),
            application_fee_amount: z.number().nullish(),
          })
          .nullish(),
      })
      .parse(
        await this.http.request(
          "GET",
          `/v1/payment_intents/${encodeURIComponent(input.paymentRef)}?expand[]=latest_charge`,
          undefined,
          { account: input.account },
        ),
      );
    const feeRef = intent.latest_charge?.application_fee;
    if (!feeRef) return;
    const path = `/v1/application_fees/${encodeURIComponent(feeRef)}`;
    const fee = z
      .object({ amount: z.number().int(), amount_refunded: z.number().int() })
      .parse(await this.http.request("GET", path));
    const owed = fee.amount - fee.amount_refunded - input.targetFeeMinor;
    if (owed <= 0) return;
    await this.http.request(
      "POST",
      `${path}/refunds`,
      { amount: owed },
      { idempotencyKey: `corvo-fee-trim-${feeRef}-${input.targetFeeMinor}` },
    );
  }

  async listApplicationFees(input: { from: Date; to: Date }): Promise<ApplicationFeeRecord[]> {
    const all: ApplicationFeeRecord[] = [];
    let startingAfter: string | undefined;
    for (;;) {
      const query = new URLSearchParams({
        limit: "100",
        "created[gte]": String(Math.floor(input.from.getTime() / 1000)),
        "created[lt]": String(Math.floor(input.to.getTime() / 1000)),
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const page = feeListSchema.parse(
        await this.http.request("GET", `/v1/application_fees?${query}`),
      );
      for (const fee of page.data) {
        all.push({
          ref: fee.id,
          account: fee.account,
          currency: fee.currency.toUpperCase(),
          amountMinor: fee.amount,
          refundedMinor: fee.amount_refunded,
          createdAt: new Date(fee.created * 1000),
        });
      }
      const last = page.data.at(-1);
      if (!page.has_more || !last) return all;
      startingAfter = last.id;
    }
  }

  parseWebhook(rawBody: string, headers: Headers): NormalizedPaymentEvent | "ignored" | null {
    if (!verifyStripeSignature(this.config.connectWebhookSecret, rawBody, headers, this.now())) {
      return null;
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return "ignored";
    }
    return normalizeStripeEvent(event) ?? "ignored";
  }
}

/** Stripe takes a percentage with at most two decimals; it rounds up so the fee is never below the target. */
function feePercent(feeMinor: number, amountMinor: number): string {
  if (amountMinor <= 0) throw new Error("A charge needs an amount");
  const hundredths = Math.ceil((feeMinor * 10_000) / amountMinor);
  return (Math.min(10_000, Math.max(0, hundredths)) / 100).toFixed(2);
}

function toAccountStatus(account: z.infer<typeof accountSchema>): ConnectedAccountStatus {
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const disabledReason = account.requirements?.disabled_reason ?? null;
  const state = disabledReason?.startsWith("rejected")
    ? "disabled"
    : chargesEnabled && payoutsEnabled
      ? "active"
      : account.details_submitted
        ? "restricted"
        : "pending";
  return {
    account: account.id,
    state,
    chargesEnabled,
    payoutsEnabled,
    requirementsDue: account.requirements?.currently_due ?? [],
  };
}

const record = z.record(z.string(), z.unknown());
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;
const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) ? value : undefined;
const stringMap = (value: unknown): Record<string, string> => {
  const parsed = record.safeParse(value);
  if (!parsed.success) return {};
  return Object.fromEntries(
    Object.entries(parsed.data).filter((entry): entry is [string, string] => {
      return typeof entry[1] === "string";
    }),
  );
};
const expandedId = (value: unknown): string | undefined =>
  str(value) ?? str(record.safeParse(value).data?.id);
const date = (seconds: unknown) => {
  const value = int(seconds);
  return value === undefined ? null : new Date(value * 1000);
};
const refs = (...values: unknown[]) => [
  ...new Set(values.map((value) => expandedId(value)).filter((value): value is string => !!value)),
];

const REMOTE_STATUSES: Record<string, PaymentRemoteStatus> = {
  active: "active",
  trialing: "active",
  past_due: "past_due",
  unpaid: "unpaid",
  canceled: "canceled",
  incomplete_expired: "canceled",
  incomplete: "incomplete",
  paused: "paused",
};

const INVOICE_REASONS = {
  subscription_create: "create",
  subscription_cycle: "cycle",
  subscription_update: "update",
} as const;

/** Reads a Stripe event envelope; null for anything Rook does not act on. */
export function normalizeStripeEvent(raw: unknown): NormalizedPaymentEvent | null {
  const envelope = record.safeParse(raw).data;
  const eventRef = str(envelope?.id);
  const type = str(envelope?.type);
  const object = record.safeParse(record.safeParse(envelope?.data).data?.object).data;
  if (!envelope || !eventRef || !type || !object) return null;
  const account = str(envelope.account) ?? null;
  const base = { eventRef, account };
  const currency = (value: unknown) => (str(value) ?? "").toUpperCase();

  switch (type) {
    case "account.updated": {
      const parsed = accountSchema.safeParse(object);
      return parsed.success
        ? { ...base, account: parsed.data.id, type, status: toAccountStatus(parsed.data) }
        : null;
    }
    case "invoice.paid":
    case "invoice.created":
    case "invoice.payment_failed": {
      const details = record.safeParse(
        record.safeParse(object.parent).data?.subscription_details,
      ).data;
      const legacy = record.safeParse(object.subscription_details).data;
      const subscriptionRef = expandedId(details?.subscription) ?? expandedId(object.subscription);
      const invoiceRef = str(object.id);
      if (!subscriptionRef || !invoiceRef) return null;
      const metadata = stringMap(details?.metadata ?? legacy?.metadata);
      if (type === "invoice.created") {
        const amountDueMinor = int(object.amount_due);
        return object.status === "draft" && amountDueMinor !== undefined
          ? {
              ...base,
              type: "invoice.draft",
              invoiceRef,
              subscriptionRef,
              amountDueMinor,
              currency: currency(object.currency),
              metadata,
            }
          : null;
      }
      const customerRef = expandedId(object.customer) ?? null;
      if (type === "invoice.payment_failed") {
        return {
          ...base,
          type: "subscription.payment_failed",
          subscriptionRef,
          customerRef,
          invoiceRef,
          metadata,
        };
      }
      const amountMinor = int(object.amount_paid);
      if (!amountMinor || amountMinor <= 0) return null;
      const periods = (
        z.array(record).safeParse(record.safeParse(object.lines).data?.data).data ?? []
      )
        .map((line) => record.safeParse(line.period).data)
        .filter((period) => int(period?.start) !== undefined && int(period?.end) !== undefined);
      const start = Math.min(...periods.map((period) => int(period?.start) as number));
      const end = Math.max(...periods.map((period) => int(period?.end) as number));
      if (!periods.length) return null;
      const firstPayment = record.safeParse(
        z.array(record).safeParse(record.safeParse(object.payments).data?.data).data?.[0]?.payment,
      ).data;
      return {
        ...base,
        type: "subscription.paid",
        subscriptionRef,
        customerRef,
        invoiceRef,
        paymentRefs: refs(object.payment_intent, firstPayment?.payment_intent, invoiceRef),
        amountMinor,
        currency: currency(object.currency),
        periodStart: new Date(start * 1000),
        periodEnd: new Date(end * 1000),
        reason:
          INVOICE_REASONS[str(object.billing_reason) as keyof typeof INVOICE_REASONS] ?? "other",
        metadata,
      };
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscriptionRef = str(object.id);
      if (!subscriptionRef) return null;
      const item = record.safeParse(
        z.array(record).safeParse(record.safeParse(object.items).data?.data).data?.[0],
      ).data;
      const status =
        type === "customer.subscription.deleted"
          ? "canceled"
          : REMOTE_STATUSES[str(object.status) ?? ""];
      if (!status) return null;
      return {
        ...base,
        type: "subscription.updated",
        subscriptionRef,
        customerRef: expandedId(object.customer) ?? null,
        status,
        periodStart: date(object.current_period_start ?? item?.current_period_start),
        periodEnd: date(object.current_period_end ?? item?.current_period_end),
        cancelAtPeriodEnd: object.cancel_at_period_end === true,
        metadata: stringMap(object.metadata),
      };
    }
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      if (object.mode !== "payment" || object.payment_status !== "paid") return null;
      const amountMinor = int(object.amount_total);
      if (!amountMinor || amountMinor <= 0) return null;
      return {
        ...base,
        type: "topup.paid",
        paymentRefs: refs(object.payment_intent),
        customerRef: expandedId(object.customer) ?? null,
        amountMinor,
        currency: currency(object.currency),
        metadata: stringMap(object.metadata),
      };
    }
    case "charge.refunded": {
      const refunded = int(object.amount_refunded);
      const paymentRefs = refs(object.payment_intent, object.invoice, object.id);
      const chargeAmountMinor = int(object.amount);
      return refunded && chargeAmountMinor && paymentRefs.length
        ? {
            ...base,
            type: "payment.refunded",
            paymentRefs,
            refundedMinor: refunded,
            chargeAmountMinor,
            applicationFeeRef: expandedId(object.application_fee) ?? null,
            currency: currency(object.currency),
          }
        : null;
    }
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed": {
      const disputeRef = str(object.id);
      const amountMinor = int(object.amount);
      if (!disputeRef || amountMinor === undefined) return null;
      return {
        ...base,
        type: "payment.disputed",
        disputeRef,
        paymentRefs: refs(object.payment_intent, object.charge),
        amountMinor,
        currency: currency(object.currency),
        reason: str(object.reason) ?? "unknown",
        status: str(object.status) ?? "needs_response",
      };
    }
    case "payout.paid":
    case "payout.failed": {
      const payoutRef = str(object.id);
      const amountMinor = int(object.amount);
      if (!payoutRef || amountMinor === undefined) return null;
      return {
        ...base,
        type,
        payoutRef,
        amountMinor,
        currency: currency(object.currency),
        arrivedAt: date(object.arrival_date),
      };
    }
    default:
      return null;
  }
}

/** Payments are on when the key and the Connect endpoint's secret are both set. */
export function stripeConnectConfigFromEnv(env: {
  stripeSecretKey?: string;
  stripeConnectWebhookSecret?: string;
}): StripeConnectConfig | undefined {
  const secretKey = env.stripeSecretKey?.trim();
  const connectWebhookSecret = env.stripeConnectWebhookSecret?.trim();
  if (!connectWebhookSecret) return undefined;
  if (!secretKey) {
    throw new Error("Stripe Connect is partially configured; set STRIPE_SECRET_KEY");
  }
  return { secretKey, connectWebhookSecret };
}
