/**
 * The Connect half of the in-process Stripe substitute: connected accounts, direct-charge checkout
 * on them, Rook's application fee, refunds, the billing portal and the events a connected account
 * sends. Only what the Connect adapter calls; the numbers it hands back follow Stripe's rules
 * (a percentage fee rounds to the minor unit, a refund hands the fee back in proportion).
 */

export interface StripeEnvelope {
  id: string;
  type: string;
  account?: string;
  data: { object: Record<string, unknown> };
}

interface ConnectAccount {
  id: string;
  email: string;
  country: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements: { currently_due: string[]; disabled_reason: string | null };
  portalConfiguration: string | null;
  customers: Set<string>;
}

interface Session {
  id: string;
  account: string;
  mode: "payment" | "subscription";
  status: "open" | "complete";
  amount: number;
  currency: string;
  customer: string | null;
  feeAmount: number | null;
  feePercent: number | null;
  metadata: Record<string, string>;
  subscriptionMetadata: Record<string, string>;
}

export interface EmulatedCharge {
  id: string;
  account: string;
  payment_intent: string;
  invoice: string | null;
  amount: number;
  currency: string;
  amount_refunded: number;
  fee: number;
  feeId: string;
}

export interface EmulatedSubscription {
  id: string;
  account: string;
  customer: string;
  itemId: string;
  status: string;
  amount: number;
  currency: string;
  feePercent: number;
  metadata: Record<string, string>;
  periodStart: number;
  periodEnd: number;
}

interface Invoice {
  id: string;
  account: string;
  subscription: string;
  customer: string;
  amount: number;
  currency: string;
  feeAmount: number | null;
  status: "draft" | "paid";
  reason: string;
}

const DAY = 86_400;

export class StripeConnectEmulator {
  readonly accounts = new Map<string, ConnectAccount>();
  readonly sessions: Session[] = [];
  readonly charges: EmulatedCharge[] = [];
  readonly subscriptions: EmulatedSubscription[] = [];
  readonly invoices: Invoice[] = [];
  readonly fees: Array<{
    id: string;
    account: string;
    currency: string;
    amount: number;
    amount_refunded: number;
    created: number;
  }> = [];
  private sequence = 0;

  constructor(
    private readonly now: () => number,
    /** Added to every id, so two emulators sharing one database never mint the same account. */
    private readonly idSeed = "",
  ) {}

  private id(prefix: string) {
    return `${prefix}_fake_${this.idSeed}${++this.sequence}`;
  }

  private seconds() {
    return Math.floor(this.now() / 1000);
  }

  /** Null when the request is not one this half answers. */
  handle(
    method: string,
    path: string,
    form: Record<string, string>,
    account: string | null,
  ): Response | null {
    if (!account) return this.platform(method, path, form);
    if (!this.accounts.has(account)) return notFound("account");
    return this.connected(method, path, form, this.accounts.get(account)!);
  }

  private platform(method: string, path: string, form: Record<string, string>) {
    if (method === "POST" && path === "/v1/accounts") {
      const id = this.id("acct");
      this.accounts.set(id, {
        id,
        email: form.email ?? "",
        country: form.country ?? "US",
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        requirements: { currently_due: ["external_account"], disabled_reason: null },
        portalConfiguration: null,
        customers: new Set(),
      });
      return Response.json({ id, object: "account" });
    }
    const accountPath = /^\/v1\/accounts\/([^/]+)(\/login_links)?$/.exec(path);
    if (accountPath) {
      const found = this.accounts.get(decodeURIComponent(accountPath[1]!));
      if (!found) return notFound("account");
      if (method === "GET" && !accountPath[2]) return Response.json(accountObject(found));
      if (method === "POST" && accountPath[2]) {
        return Response.json({ url: `https://connect.stripe.com/express/${found.id}` });
      }
    }
    if (method === "POST" && path === "/v1/account_links") {
      if (!this.accounts.has(form.account ?? "")) return notFound("account");
      return Response.json({ url: `https://connect.stripe.com/setup/${form.account}` });
    }
    const feePath = /^\/v1\/application_fees\/([^/]+)(\/refunds)?$/.exec(path);
    if (feePath) {
      const fee = this.fees.find((f) => f.id === decodeURIComponent(feePath[1]!));
      if (!fee) return notFound("application_fee");
      if (method === "GET" && !feePath[2]) return Response.json(fee);
      if (method === "POST" && feePath[2]) {
        const amount = Number(form.amount);
        if (amount <= 0 || fee.amount_refunded + amount > fee.amount) {
          return error("Refund amount is greater than the fee");
        }
        fee.amount_refunded += amount;
        return Response.json({ id: this.id("fr"), amount });
      }
    }
    if (method === "GET" && path === "/v1/application_fees") {
      const gte = Number(form["created[gte]"] ?? 0);
      const lt = Number(form["created[lt]"] ?? Number.MAX_SAFE_INTEGER);
      const matching = this.fees.filter((fee) => fee.created >= gte && fee.created < lt);
      const start = form.starting_after
        ? matching.findIndex((fee) => fee.id === form.starting_after) + 1
        : 0;
      const limit = Number(form.limit ?? 10);
      return Response.json({
        has_more: start + limit < matching.length,
        data: matching.slice(start, start + limit),
      });
    }
    return null;
  }

  private connected(method: string, path: string, form: Record<string, string>, a: ConnectAccount) {
    if (method === "POST" && path === "/v1/checkout/sessions") return this.openCheckout(a, form);
    if (path === "/v1/billing_portal/configurations") {
      if (method === "GET") {
        return Response.json({
          data: a.portalConfiguration ? [{ id: a.portalConfiguration }] : [],
        });
      }
      a.portalConfiguration = this.id("bpc");
      return Response.json({ id: a.portalConfiguration });
    }
    if (method === "POST" && path === "/v1/billing_portal/sessions") {
      if (!a.customers.has(form.customer ?? "")) return notFound("customer", "customer");
      return Response.json({
        url: `https://billing.stripe.com/p/${a.id}/${form.customer}`,
        configuration: form.configuration,
      });
    }
    const intent = /^\/v1\/payment_intents\/([^/]+)$/.exec(path);
    if (method === "GET" && intent) {
      const charge = this.charges.find(
        (c) => c.payment_intent === decodeURIComponent(intent[1]!) && c.account === a.id,
      );
      if (!charge) return notFound("payment_intent");
      return Response.json({
        id: charge.payment_intent,
        latest_charge: { id: charge.id, application_fee: charge.feeId },
      });
    }
    const subscription = /^\/v1\/subscriptions\/([^/]+)$/.exec(path);
    if (subscription) {
      const found = this.subscriptions.find(
        (s) => s.id === decodeURIComponent(subscription[1]!) && s.account === a.id,
      );
      if (!found) return notFound("subscription");
      if (method === "GET") return Response.json(subscriptionObject(found));
      return this.changePlan(found, form);
    }
    const invoice = /^\/v1\/invoices\/([^/]+)$/.exec(path);
    if (method === "POST" && invoice) {
      const found = this.invoices.find(
        (i) => i.id === decodeURIComponent(invoice[1]!) && i.account === a.id,
      );
      if (!found) return notFound("invoice");
      if (found.status !== "draft") {
        return error("Finalized invoices cannot be edited.");
      }
      found.feeAmount = Number(form.application_fee_amount);
      return Response.json({ id: found.id, application_fee_amount: found.feeAmount });
    }
    if (method === "POST" && path === "/v1/refunds") return this.refund(a, form);
    return null;
  }

  private openCheckout(a: ConnectAccount, form: Record<string, string>) {
    const mode = form.mode === "subscription" ? "subscription" : "payment";
    const feeAmount = form["payment_intent_data[application_fee_amount]"];
    const feePercent = form["subscription_data[application_fee_percent]"];
    const metadata = (prefix: string) =>
      Object.fromEntries(
        Object.entries(form)
          .filter(([key]) => key.startsWith(`${prefix}[`))
          .map(([key, value]) => [key.slice(prefix.length + 1, -1), value]),
      );
    if (mode === "payment" && feeAmount === undefined) return error("Missing application fee");
    if (form.customer && !a.customers.has(form.customer)) return notFound("customer", "customer");
    const session: Session = {
      id: this.id("cs"),
      account: a.id,
      mode,
      status: "open",
      amount: Number(form["line_items[0][price_data][unit_amount]"]),
      currency: form["line_items[0][price_data][currency]"] ?? "usd",
      customer: form.customer ?? null,
      feeAmount: feeAmount === undefined ? null : Number(feeAmount),
      feePercent: feePercent === undefined ? null : Number(feePercent),
      metadata: metadata("metadata"),
      subscriptionMetadata: mode === "subscription" ? metadata("subscription_data[metadata]") : {},
    };
    this.sessions.push(session);
    return Response.json({
      id: session.id,
      object: "checkout.session",
      url: `https://checkout.stripe.com/c/pay/${session.id}`,
    });
  }

  private changePlan(found: EmulatedSubscription, form: Record<string, string>) {
    const amount = form["items[0][price_data][unit_amount]"];
    if (amount === undefined) return Response.json(subscriptionObject(found));
    const old = found.amount;
    found.amount = Number(amount);
    found.feePercent = Number(form.application_fee_percent ?? found.feePercent);
    found.metadata = Object.fromEntries(
      Object.entries(form)
        .filter(([key]) => key.startsWith("metadata["))
        .map(([key, value]) => [key.slice("metadata[".length, -1), value]),
    );
    // The difference for the rest of the period is invoiced and paid at once.
    const total = found.periodEnd - found.periodStart;
    const left = Math.max(0, found.periodEnd - this.seconds());
    const difference = Math.floor(((found.amount - old) * left) / total);
    if (form.proration_behavior === "always_invoice" && difference > 0) {
      this.pendingUpdates.push(
        this.invoice(found, { amount: difference, reason: "subscription_update" }),
      );
    }
    return Response.json(subscriptionObject(found));
  }

  /** Invoices a plan change made, until the test collects them with `payInvoice`. */
  readonly pendingUpdates: Invoice[] = [];

  private refund(a: ConnectAccount, form: Record<string, string>) {
    const charge = this.charges.find(
      (c) => c.payment_intent === form.payment_intent && c.account === a.id,
    );
    if (!charge) return notFound("payment_intent");
    const amount = form.amount ? Number(form.amount) : charge.amount - charge.amount_refunded;
    if (amount <= 0 || charge.amount_refunded + amount > charge.amount) {
      return error("Refund amount is greater than unrefunded amount on charge");
    }
    charge.amount_refunded += amount;
    if (form.refund_application_fee === "true") {
      const fee = this.fees.find((f) => f.id === charge.feeId);
      if (fee)
        fee.amount_refunded = Math.floor((fee.amount * charge.amount_refunded) / charge.amount);
    }
    return Response.json({ id: this.id("re"), amount, charge: charge.id });
  }

  private charge(
    a: ConnectAccount,
    input: { invoice: string | null; amount: number; currency: string; fee: number },
  ) {
    const charge: EmulatedCharge = {
      id: this.id("ch"),
      account: a.id,
      payment_intent: this.id("pi"),
      invoice: input.invoice,
      amount: input.amount,
      currency: input.currency,
      amount_refunded: 0,
      fee: input.fee,
      feeId: this.id("fee"),
    };
    this.charges.push(charge);
    this.fees.push({
      id: charge.feeId,
      account: a.id,
      currency: input.currency,
      amount: input.fee,
      amount_refunded: 0,
      created: this.seconds(),
    });
    return charge;
  }

  private invoice(sub: EmulatedSubscription, input: { amount?: number; reason: string }): Invoice {
    const invoice: Invoice = {
      id: this.id("in"),
      account: sub.account,
      subscription: sub.id,
      customer: sub.customer,
      amount: input.amount ?? sub.amount,
      currency: sub.currency,
      feeAmount: null,
      status: "draft",
      reason: input.reason,
    };
    this.invoices.push(invoice);
    return invoice;
  }

  private envelope(
    type: string,
    object: Record<string, unknown>,
    account?: string,
  ): StripeEnvelope {
    return { id: this.id("evt"), type, ...(account ? { account } : {}), data: { object } };
  }

  // ---- What a test does to the world ----

  /** The partner finishes onboarding: the account can charge and be paid out. */
  activateAccount(id: string): StripeEnvelope {
    const found = this.mustAccount(id);
    Object.assign(found, { charges_enabled: true, payouts_enabled: true, details_submitted: true });
    found.requirements = { currently_due: [], disabled_reason: null };
    return this.envelope("account.updated", accountObject(found), id);
  }

  /** Stripe asks the partner for more: charging stops. */
  restrictAccount(
    id: string,
    due: string[],
    disabledReason: string | null = "requirements.past_due",
  ) {
    const found = this.mustAccount(id);
    Object.assign(found, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: true,
    });
    found.requirements = { currently_due: due, disabled_reason: disabledReason };
    return this.envelope("account.updated", accountObject(found), id);
  }

  /** The customer pays the account's latest open checkout; returns what Stripe sends after. */
  payCheckout(accountId: string): StripeEnvelope[] {
    const a = this.mustAccount(accountId);
    const session = this.sessions.findLast((s) => s.account === accountId && s.status === "open");
    if (!session) throw new Error(`No open checkout on ${accountId}`);
    session.status = "complete";
    const customer = session.customer ?? this.id("cus");
    a.customers.add(customer);
    const now = this.seconds();
    if (session.mode === "payment") {
      const charge = this.charge(a, {
        invoice: null,
        amount: session.amount,
        currency: session.currency,
        fee: session.feeAmount ?? 0,
      });
      return [
        this.envelope(
          "checkout.session.completed",
          {
            id: session.id,
            object: "checkout.session",
            mode: "payment",
            payment_status: "paid",
            payment_intent: charge.payment_intent,
            customer,
            amount_total: session.amount,
            currency: session.currency,
            metadata: session.metadata,
          },
          accountId,
        ),
      ];
    }
    const subscription: EmulatedSubscription = {
      id: this.id("sub"),
      account: accountId,
      customer,
      itemId: this.id("si"),
      status: "active",
      amount: session.amount,
      currency: session.currency,
      feePercent: session.feePercent ?? 0,
      metadata: session.subscriptionMetadata,
      periodStart: now,
      periodEnd: now + 30 * DAY,
    };
    this.subscriptions.push(subscription);
    return this.payInvoice(this.invoice(subscription, { reason: "subscription_create" }).id);
  }

  /** The next period's draft invoice, as Stripe announces it before it is finalized. */
  renew(subscriptionId: string): StripeEnvelope {
    const sub = this.mustSubscription(subscriptionId);
    sub.periodStart = sub.periodEnd;
    sub.periodEnd += 30 * DAY;
    const invoice = this.invoice(sub, { reason: "subscription_cycle" });
    return this.envelope("invoice.created", this.invoiceObject(invoice), sub.account);
  }

  /** A plan change made through the API is invoiced; returns its invoice id, if any. */
  takeUpdateInvoice(): string | undefined {
    return this.pendingUpdates.shift()?.id;
  }

  /** The invoice is finalized and paid: the fee is the amount set on it, else the subscription's percent. */
  payInvoice(invoiceId: string): StripeEnvelope[] {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error(`No invoice ${invoiceId}`);
    const sub = this.mustSubscription(invoice.subscription);
    const a = this.mustAccount(invoice.account);
    invoice.status = "paid";
    const fee = invoice.feeAmount ?? Math.round((invoice.amount * sub.feePercent) / 100);
    const charge = this.charge(a, {
      invoice: invoice.id,
      amount: invoice.amount,
      currency: invoice.currency,
      fee,
    });
    return [
      this.envelope(
        "invoice.paid",
        { ...this.invoiceObject(invoice), payment_intent: charge.payment_intent },
        invoice.account,
      ),
    ];
  }

  /** Stripe could not collect: the invoice fails and the subscription goes past due. */
  failPayment(subscriptionId: string): StripeEnvelope[] {
    const sub = this.mustSubscription(subscriptionId);
    sub.status = "past_due";
    const invoice = this.invoice(sub, { reason: "subscription_cycle" });
    return [
      this.envelope("invoice.payment_failed", this.invoiceObject(invoice), sub.account),
      this.subscriptionUpdated(subscriptionId),
    ];
  }

  setSubscriptionStatus(subscriptionId: string, status: string): StripeEnvelope {
    this.mustSubscription(subscriptionId).status = status;
    return this.subscriptionUpdated(subscriptionId);
  }

  subscriptionUpdated(subscriptionId: string): StripeEnvelope {
    const sub = this.mustSubscription(subscriptionId);
    return this.envelope("customer.subscription.updated", subscriptionObject(sub), sub.account);
  }

  chargeRefunded(chargeId: string): StripeEnvelope {
    const charge = this.charges.find((c) => c.id === chargeId);
    if (!charge) throw new Error(`No charge ${chargeId}`);
    return this.envelope(
      "charge.refunded",
      {
        id: charge.id,
        object: "charge",
        payment_intent: charge.payment_intent,
        invoice: charge.invoice,
        amount: charge.amount,
        amount_refunded: charge.amount_refunded,
        application_fee: charge.feeId,
        currency: charge.currency,
      },
      charge.account,
    );
  }

  dispute(chargeId: string, status = "needs_response"): StripeEnvelope {
    const charge = this.charges.find((c) => c.id === chargeId);
    if (!charge) throw new Error(`No charge ${chargeId}`);
    return this.envelope(
      "charge.dispute.created",
      {
        id: `dp_${charge.id}`,
        object: "dispute",
        charge: charge.id,
        payment_intent: charge.payment_intent,
        amount: charge.amount,
        currency: charge.currency,
        reason: "fraudulent",
        status,
      },
      charge.account,
    );
  }

  payout(
    accountId: string,
    amount: number,
    currency: string,
    type = "payout.paid",
  ): StripeEnvelope {
    return this.envelope(
      type,
      {
        id: this.id("po"),
        object: "payout",
        amount,
        currency,
        arrival_date: this.seconds() + 2 * DAY,
      },
      accountId,
    );
  }

  /** The partner's own Stripe dashboard refunds a payment, outside Rook. */
  refundInDashboard(chargeId: string, amount?: number) {
    const charge = this.charges.find((c) => c.id === chargeId);
    if (!charge) throw new Error(`No charge ${chargeId}`);
    const response = this.refund(this.mustAccount(charge.account), {
      payment_intent: charge.payment_intent,
      ...(amount === undefined ? {} : { amount: String(amount) }),
    });
    if (!response.ok) throw new Error("Refund failed");
  }

  private invoiceObject(invoice: Invoice): Record<string, unknown> {
    const sub = this.mustSubscription(invoice.subscription);
    return {
      id: invoice.id,
      object: "invoice",
      status: invoice.status,
      customer: invoice.customer,
      currency: invoice.currency,
      amount_due: invoice.amount,
      amount_paid: invoice.status === "paid" ? invoice.amount : 0,
      billing_reason: invoice.reason,
      parent: {
        subscription_details: { subscription: sub.id, metadata: sub.metadata },
      },
      lines: {
        data: [{ period: { start: sub.periodStart, end: sub.periodEnd } }],
      },
    };
  }

  private mustAccount(id: string) {
    const found = this.accounts.get(id);
    if (!found) throw new Error(`No account ${id}`);
    return found;
  }

  private mustSubscription(id: string) {
    const found = this.subscriptions.find((s) => s.id === id);
    if (!found) throw new Error(`No subscription ${id}`);
    return found;
  }
}

function accountObject(a: ConnectAccount) {
  return {
    id: a.id,
    object: "account",
    charges_enabled: a.charges_enabled,
    payouts_enabled: a.payouts_enabled,
    details_submitted: a.details_submitted,
    requirements: a.requirements,
  };
}

function subscriptionObject(s: EmulatedSubscription) {
  return {
    id: s.id,
    object: "subscription",
    customer: s.customer,
    status: s.status,
    metadata: s.metadata,
    current_period_start: s.periodStart,
    current_period_end: s.periodEnd,
    cancel_at_period_end: false,
    items: { data: [{ id: s.itemId }] },
  };
}

function notFound(what: string, param?: string) {
  return Response.json(
    {
      error: {
        type: "invalid_request_error",
        code: "resource_missing",
        ...(param ? { param } : {}),
        message: `No such ${what}`,
      },
    },
    { status: 404 },
  );
}

function error(message: string) {
  return Response.json({ error: { type: "invalid_request_error", message } }, { status: 400 });
}
