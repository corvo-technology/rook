import type { NormalizedPaymentEvent, PaymentsProvider } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { StripePaymentsProvider, stripeConnectConfigFromEnv } from "./stripe-connect.js";
import { signStripeWebhook } from "./stripe-http.js";
import type { StripeEnvelope } from "./testing/stripe-connect-emulator.js";
import { StripeEmulator } from "./testing/stripe-emulator.js";

const NOW = Date.UTC(2026, 10, 10, 12);
const SECRET = "whsec_connect_fake";

/** The provider over the wire emulator; `deliver` is what Stripe would POST to the endpoint. */
function harness() {
  const wire = new StripeEmulator({ now: () => NOW });
  const provider: PaymentsProvider = new StripePaymentsProvider({
    secretKey: wire.secretKey,
    connectWebhookSecret: SECRET,
    fetch: wire.fetch,
    now: () => NOW,
  });
  const deliver = (envelope: StripeEnvelope, timestamp = Math.floor(NOW / 1000)) => {
    const body = JSON.stringify(envelope);
    return provider.parseWebhook(
      body,
      new Headers({ "stripe-signature": signStripeWebhook(SECRET, body, timestamp) }),
    );
  };
  return { wire, connect: wire.connect, provider, deliver };
}

const checkout = {
  currency: "BRL",
  amountMinor: 13_000,
  applicationFeeMinor: 8_000,
  productName: "Team",
  customerEmail: "ana@example.com",
  metadata: { corvo_partner: "p1", corvo_tenant: "t1", corvo_plan: "team" },
  successUrl: "https://app.example/ok",
  cancelUrl: "https://app.example/no",
};

async function activeAccount(h: ReturnType<typeof harness>) {
  const { account } = await h.provider.createConnectedAccount({
    partnerId: "p1",
    country: "BR",
    businessName: "Agency",
  });
  h.deliver(h.connect.activateAccount(account));
  return account;
}

function expectEvent<T extends NormalizedPaymentEvent["type"]>(
  event: NormalizedPaymentEvent | "ignored" | null,
  type: T,
): Extract<NormalizedPaymentEvent, { type: T }> {
  expect(event).not.toBeNull();
  expect(event).not.toBe("ignored");
  expect((event as NormalizedPaymentEvent).type).toBe(type);
  return event as Extract<NormalizedPaymentEvent, { type: T }>;
}

describe("Stripe Connect onboarding", () => {
  it("opens one account per partner and reads its state as the partner finishes", async () => {
    const h = harness();
    const { account } = await h.provider.createConnectedAccount({
      partnerId: "p1",
      country: "BR",
      businessName: "Agency",
    });
    const again = await h.provider.createConnectedAccount({
      partnerId: "p1",
      country: "BR",
      businessName: "Agency",
    });
    expect(again.account).toBe(account);
    expect(h.connect.accounts.size).toBe(1);

    expect((await h.provider.getAccountStatus(account)).state).toBe("pending");
    expect(
      (
        await h.provider.createOnboardingLink({
          account,
          returnUrl: "https://app.example/back",
          refreshUrl: "https://app.example/again",
        })
      ).url,
    ).toContain(account);

    const activated = expectEvent(h.deliver(h.connect.activateAccount(account)), "account.updated");
    expect(activated.status).toMatchObject({ state: "active", chargesEnabled: true });
    expect((await h.provider.getAccountStatus(account)).state).toBe("active");

    const restricted = expectEvent(
      h.deliver(h.connect.restrictAccount(account, ["individual.verification.document"], null)),
      "account.updated",
    );
    expect(restricted.status).toMatchObject({
      state: "restricted",
      requirementsDue: ["individual.verification.document"],
    });
    const rejected = expectEvent(
      h.deliver(h.connect.restrictAccount(account, [], "rejected.fraud")),
      "account.updated",
    );
    expect(rejected.status.state).toBe("disabled");
    expect((await h.provider.createDashboardLink(account)).url).toContain(account);
  });
});

describe("Stripe Connect checkout", () => {
  it("charges on the connected account with the fee as a percentage that rounds to Rook's share", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const request = h.wire.requests.findLast((r) => r.path === "/v1/checkout/sessions")!;
    expect(request.headers.get("stripe-account")).toBe(account);
    expect(request.form).toMatchObject({
      mode: "subscription",
      "line_items[0][price_data][currency]": "brl",
      "line_items[0][price_data][unit_amount]": "13000",
      "line_items[0][price_data][recurring][interval]": "month",
      "subscription_data[application_fee_percent]": "61.54",
      "subscription_data[metadata][corvo_tenant]": "t1",
      customer_email: "ana@example.com",
    });
    // 61.54% of 130.00 is 80.00 once Stripe rounds to the centavo.
    expect(Math.round((13_000 * 61.54) / 100)).toBe(8_000);
  });

  it("sets Rook's exact fee on a top-up and grants nothing until the event arrives", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createTopUpCheckout({ ...checkout, account });
    const request = h.wire.requests.findLast((r) => r.path === "/v1/checkout/sessions")!;
    expect(request.form).toMatchObject({
      mode: "payment",
      "payment_intent_data[application_fee_amount]": "8000",
      customer_creation: "always",
    });
    const [paid] = h.connect.payCheckout(account);
    const topup = expectEvent(h.deliver(paid!), "topup.paid");
    expect(topup).toMatchObject({ amountMinor: 13_000, currency: "BRL", account });
    expect(topup.metadata.corvo_plan).toBe("team");
    expect(h.connect.fees.at(-1)).toMatchObject({ amount: 8_000, account });
  });

  it("reuses the customer of the account for a later top-up", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");
    await h.provider.createTopUpCheckout({ ...checkout, account, customerRef: paid.customerRef! });
    const request = h.wire.requests.findLast((r) => r.path === "/v1/checkout/sessions")!;
    expect(request.form.customer).toBe(paid.customerRef);
    expect(request.form.customer_creation).toBeUndefined();
  });
});

describe("Stripe Connect events", () => {
  it("normalizes a paid subscription with its period, amount and metadata", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");
    expect(paid).toMatchObject({
      account,
      amountMinor: 13_000,
      currency: "BRL",
      reason: "create",
      metadata: { corvo_partner: "p1", corvo_tenant: "t1", corvo_plan: "team" },
    });
    expect(paid.periodEnd.getTime() - paid.periodStart.getTime()).toBe(30 * 86_400_000);
    expect(paid.paymentRefs).toContain(paid.invoiceRef);
    expect(paid.paymentRefs.length).toBe(2);
    expect(h.connect.fees.at(-1)!.amount).toBe(8_000);
  });

  it("refuses an event with a bad signature or an old timestamp", async () => {
    const h = harness();
    const account = await activeAccount(h);
    const body = JSON.stringify(h.connect.restrictAccount(account, []));
    expect(h.provider.parseWebhook(body, new Headers())).toBeNull();
    expect(
      h.provider.parseWebhook(
        body,
        new Headers({ "stripe-signature": signStripeWebhook("whsec_other", body, NOW / 1000) }),
      ),
    ).toBeNull();
    expect(h.deliver(h.connect.restrictAccount(account, []), NOW / 1000 - 3600)).toBeNull();
    const unrelated = JSON.stringify({
      id: "evt_1",
      type: "customer.created",
      data: { object: {} },
    });
    expect(
      h.provider.parseWebhook(
        unrelated,
        new Headers({
          "stripe-signature": signStripeWebhook(SECRET, unrelated, Math.floor(NOW / 1000)),
        }),
      ),
    ).toBe("ignored");
  });

  it("tells a failed renewal, a status change, a refund, a dispute and a payout apart", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");

    const [failed, updated] = h.connect.failPayment(paid.subscriptionRef);
    expectEvent(h.deliver(failed!), "subscription.payment_failed");
    expect(expectEvent(h.deliver(updated!), "subscription.updated").status).toBe("past_due");
    expect(
      expectEvent(
        h.deliver(h.connect.setSubscriptionStatus(paid.subscriptionRef, "unpaid")),
        "subscription.updated",
      ).status,
    ).toBe("unpaid");

    const charge = h.connect.charges[0]!;
    await h.provider.refund({
      account,
      paymentRef: charge.payment_intent,
      amountMinor: 3_000,
      key: "r1",
    });
    const refunded = expectEvent(
      h.deliver(h.connect.chargeRefunded(charge.id)),
      "payment.refunded",
    );
    expect(refunded).toMatchObject({ refundedMinor: 3_000, currency: "BRL" });
    expect(refunded.paymentRefs).toContain(charge.payment_intent);

    expect(expectEvent(h.deliver(h.connect.dispute(charge.id)), "payment.disputed")).toMatchObject({
      amountMinor: 13_000,
      reason: "fraudulent",
      status: "needs_response",
    });
    expect(
      expectEvent(h.deliver(h.connect.payout(account, 5_000, "brl")), "payout.paid"),
    ).toMatchObject({ amountMinor: 5_000, currency: "BRL" });
    expectEvent(
      h.deliver(h.connect.payout(account, 5_000, "brl", "payout.failed")),
      "payout.failed",
    );
  });
});

describe("Stripe Connect fees, refunds and plan changes", () => {
  it("sets the exact fee on a renewal's draft invoice", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");
    const draft = expectEvent(h.deliver(h.connect.renew(paid.subscriptionRef)), "invoice.draft");
    expect(draft.amountDueMinor).toBe(13_000);
    await h.provider.setInvoiceApplicationFee({
      account,
      invoiceRef: draft.invoiceRef,
      applicationFeeMinor: 8_000,
    });
    h.connect.payInvoice(draft.invoiceRef);
    expect(h.connect.fees.at(-1)!.amount).toBe(8_000);
  });

  it("refunds once per key and hands the fee back in proportion", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createTopUpCheckout({ ...checkout, account });
    h.connect.payCheckout(account);
    const charge = h.connect.charges[0]!;
    const refund = {
      account,
      paymentRef: charge.payment_intent,
      amountMinor: 6_500,
      key: "refund-1",
    };
    const first = await h.provider.refund(refund);
    const second = await h.provider.refund(refund);
    expect(second).toEqual(first);
    expect(first.refundedMinor).toBe(6_500);
    expect(h.connect.charges[0]!.amount_refunded).toBe(6_500);
    expect(h.connect.fees[0]).toMatchObject({ amount: 8_000, amount_refunded: 4_000 });
  });

  it("hands Rook's fee back for a refund the partner made on its own, once", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createTopUpCheckout({ ...checkout, account });
    h.connect.payCheckout(account);
    const charge = h.connect.charges[0]!;
    h.connect.refundInDashboard(charge.id, 6_500);
    expect(h.connect.fees[0]!.amount_refunded).toBe(0);
    const refunded = expectEvent(
      h.deliver(h.connect.chargeRefunded(charge.id)),
      "payment.refunded",
    );
    expect(refunded.applicationFeeRef).toBe(charge.feeId);
    const input = {
      applicationFeeRef: refunded.applicationFeeRef!,
      chargeAmountMinor: refunded.chargeAmountMinor,
      refundedMinor: refunded.refundedMinor,
    };
    await h.provider.refundApplicationFee(input);
    await h.provider.refundApplicationFee(input);
    expect(h.connect.fees[0]!.amount_refunded).toBe(4_000);
    h.connect.refundInDashboard(charge.id);
    const rest = expectEvent(h.deliver(h.connect.chargeRefunded(charge.id)), "payment.refunded");
    await h.provider.refundApplicationFee({ ...input, refundedMinor: rest.refundedMinor });
    expect(h.connect.fees[0]!.amount_refunded).toBe(8_000);
  });

  it("moves a plan with the new fee and invoices the difference", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");
    await h.provider.changeSubscriptionPlan({
      account,
      subscriptionRef: paid.subscriptionRef,
      currency: "BRL",
      amountMinor: 26_000,
      applicationFeeMinor: 16_000,
      productName: "Business",
      metadata: { corvo_plan: "business" },
      proration: "now",
    });
    const sub = h.connect.subscriptions[0]!;
    expect(sub).toMatchObject({ amount: 26_000, feePercent: 61.54 });
    expect(sub.metadata.corvo_plan).toBe("business");
    const invoiceRef = h.connect.takeUpdateInvoice();
    expect(invoiceRef).toBeDefined();
    const update = expectEvent(
      h.deliver(h.connect.payInvoice(invoiceRef!)[0]!),
      "subscription.paid",
    );
    expect(update.reason).toBe("update");
  });

  it("makes one portal configuration per account that cancels at period end", async () => {
    const h = harness();
    const account = await activeAccount(h);
    await h.provider.createSubscriptionCheckout({ ...checkout, account });
    const paid = expectEvent(h.deliver(h.connect.payCheckout(account)[0]!), "subscription.paid");
    const portal = {
      account,
      customerRef: paid.customerRef!,
      returnUrl: "https://app.example/back",
    };
    expect((await h.provider.createCustomerPortal(portal)).url).toContain(paid.customerRef!);
    await h.provider.createCustomerPortal(portal);
    const created = h.wire.requests.filter(
      (r) => r.method === "POST" && r.path === "/v1/billing_portal/configurations",
    );
    expect(created).toHaveLength(1);
    expect(created[0]!.form).toMatchObject({
      "features[subscription_cancel][mode]": "at_period_end",
      "features[subscription_update][enabled]": "false",
      "features[payment_method_update][enabled]": "true",
    });
  });

  it("lists the application fees of a period across pages", async () => {
    const h = harness();
    const account = await activeAccount(h);
    for (let i = 0; i < 3; i++) {
      await h.provider.createTopUpCheckout({ ...checkout, account });
      h.connect.payCheckout(account);
    }
    const fees = await h.provider.listApplicationFees({
      from: new Date(NOW - 86_400_000),
      to: new Date(NOW + 86_400_000),
    });
    expect(fees).toHaveLength(3);
    expect(fees.every((fee) => fee.account === account && fee.currency === "BRL")).toBe(true);
    expect(fees.reduce((sum, fee) => sum + fee.amountMinor, 0)).toBe(24_000);
  });
});

describe("Stripe Connect configuration", () => {
  it("is off until the Connect webhook secret is set, and needs the key with it", () => {
    expect(stripeConnectConfigFromEnv({ stripeSecretKey: "sk_x" })).toBeUndefined();
    expect(() => stripeConnectConfigFromEnv({ stripeConnectWebhookSecret: "whsec_x" })).toThrow(
      /STRIPE_SECRET_KEY/,
    );
    expect(
      stripeConnectConfigFromEnv({
        stripeSecretKey: "sk_x",
        stripeConnectWebhookSecret: "whsec_x",
      }),
    ).toEqual({ secretKey: "sk_x", connectWebhookSecret: "whsec_x" });
  });
});
