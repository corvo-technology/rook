import { StripeEmulator, StripePaymentsProvider, signStripeWebhook } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  asSystem,
  commerceBalance,
  configurePartnerCommerce,
  createDb,
  createPartner,
  partnerSpaceState,
  provisionPartnerTenant,
  recordFxRate,
  seedCatalog,
} from "@corvo/db";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createWhiteLabelPayments,
  mountPaymentsWebhook,
  PAYMENTS_WEBHOOK_PATH,
  WhiteLabelError,
} from "./white-label-payments.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const NOW = new Date("2026-11-10T12:00:00Z");
const SECRET = "whsec_connect_test";

describePostgres("white label checkout and webhook (PostgreSQL)", () => {
  const suffix = `${process.pid}${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  const plan = `e2e_base_${suffix}`;
  const planUp = `e2e_up_${suffix}`;
  const pack = `e2e_pack_${suffix}`;

  /** The whole stack for one partner: Stripe emulator, adapter, service, webhook route. */
  async function world(label: string, over: { active?: boolean } = {}) {
    const wire = new StripeEmulator({ now: () => NOW.getTime(), idSeed: `${label}${suffix}_` });
    const provider = new StripePaymentsProvider({
      secretKey: wire.secretKey,
      connectWebhookSecret: SECRET,
      fetch: wire.fetch,
      now: () => NOW.getTime(),
    });
    const jobs = { enqueue: vi.fn(async () => undefined) };
    const app = new Hono();
    mountPaymentsWebhook(app, { prisma: db, provider, jobs, now: () => NOW });
    const payments = createWhiteLabelPayments({
      prisma: db,
      provider,
      webOrigin: "https://app.example.test",
      jobs,
      now: () => NOW,
    });

    const slug = `e2e-${label}-${suffix}`.toLowerCase();
    const { partner } = await createPartner(db, { slug, name: label });
    await configurePartnerCommerce(db, slug, {
      mode: "white_label",
      billingModel: "commerce",
      country: "BR",
      commissionBps: 2000,
    });
    partnerIds.push(partner.id);
    await db.partnerMarkup.create({
      data: { partnerId: partner.id, itemKind: "plan", itemKey: plan, kind: "fixed", value: 3000 },
    });
    await db.partnerMarkup.create({
      data: {
        partnerId: partner.id,
        itemKind: "plan",
        itemKey: planUp,
        kind: "fixed",
        value: 3000,
      },
    });
    await db.partnerMarkup.create({
      data: { partnerId: partner.id, itemKind: "pack", itemKey: pack, kind: "fixed", value: 3000 },
    });
    const { account } = await provider.createConnectedAccount({
      partnerId: partner.id,
      country: "BR",
      businessName: label,
    });
    await db.partner.update({
      where: { id: partner.id },
      data: { connectAccountId: account, webhookUrl: "https://hooks.example.test/rook" },
    });
    // Onboarding finishes through the same webhook a real one would use.
    const deliver = async (envelope: object, timestamp = Math.floor(NOW.getTime() / 1000)) => {
      const body = JSON.stringify(envelope);
      return app.request(PAYMENTS_WEBHOOK_PATH, {
        method: "POST",
        body,
        headers: { "stripe-signature": signStripeWebhook(SECRET, body, timestamp) },
      });
    };
    if (over.active !== false) {
      expect((await deliver(wire.connect.activateAccount(account))).status).toBe(200);
    }

    const made = await provisionPartnerTenant(db, partner, {
      externalTenantId: `org-${label}`,
      name: label,
    });
    organizationIds.push(made.organizationId);
    userIds.push(made.ownerUserId);
    const actor: Actor = {
      userId: made.ownerUserId,
      spaceId: made.spaceId,
      email: "ana@example.com",
      isDeploymentOwner: false,
    };
    const balance = () =>
      commerceBalance(
        db,
        { currency: "BRL" },
        { id: made.tenantId, organizationId: made.organizationId },
        NOW,
      );
    return {
      wire,
      provider,
      deliver,
      payments,
      actor,
      account,
      partnerId: partner.id,
      tenantId: made.tenantId,
      organizationId: made.organizationId,
      balance,
      jobs,
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const checkoutForm = (w: World) =>
    w.wire.requests.findLast((r) => r.path === "/v1/checkout/sessions")!;
  const subscribe = async (w: World) => {
    await w.payments.checkout(w.actor, { kind: "plan", key: plan });
    const [paid] = w.wire.connect.payCheckout(w.account);
    return paid!;
  };

  beforeAll(async () => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
    await seedCatalog(db, {
      plans: [
        {
          key: plan,
          name: "Base",
          prices: { BRL: { amountMinor: 10_000, creditMinor: 4_000 } },
        },
        {
          key: planUp,
          name: "Up",
          prices: { BRL: { amountMinor: 20_000, creditMinor: 9_000 } },
        },
      ],
      packs: [
        { key: pack, name: "Pack", prices: { BRL: { amountMinor: 10_000, creditMinor: 5_000 } } },
      ],
    });
    await recordFxRate(db, {
      quote: "BRL",
      rate: "5.12",
      source: "test",
      validFrom: new Date("2026-10-30T00:00:00Z"),
    });
  });
  afterAll(async () => {
    await db.revenueShareEntry.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.catalogPlan.deleteMany({ where: { key: { in: [plan, planUp] } } });
    await db.catalogPack.deleteMany({ where: { key: pack } });
    await close();
  });

  it("shows the partner's price, opens a checkout on the connected account, and grants nothing until the event", async () => {
    const w = await world("flow");
    const catalog = await w.payments.catalog(w.actor);
    expect(catalog).toMatchObject({ currency: "BRL", canPay: true, subscription: null });
    expect(catalog?.plans.find((p) => p.key === plan)).toMatchObject({
      priceMinor: 13_000,
      creditMinor: 4_000,
    });

    const { url } = await w.payments.checkout(w.actor, { kind: "plan", key: plan });
    expect(url).toContain("checkout.stripe.com");
    const form = checkoutForm(w);
    expect(form.headers.get("stripe-account")).toBe(w.account);
    expect(form.form["line_items[0][price_data][unit_amount]"]).toBe("13000");
    expect(form.form["subscription_data[application_fee_percent]"]).toBe("61.54");
    expect(form.form["subscription_data[metadata][corvo_tenant]"]).toBe(w.tenantId);
    // The redirect alone, or an open checkout, gives nothing.
    expect((await w.balance()).remainingMinor).toBe(0);
    expect(await partnerSpaceState(db, w.organizationId, NOW)).toBe("inactive");

    const paid = w.wire.connect.payCheckout(w.account)[0]!;
    expect((await w.deliver(paid)).status).toBe(200);
    expect((await w.balance()).plan.grantedMinor).toBe(4_000);
    expect(await partnerSpaceState(db, w.organizationId, NOW)).toBe("enabled");
    // 130 charged on a base of 100: Stripe's fee is 80 and the partner keeps 50.
    expect(w.wire.connect.fees.at(-1)!.amount).toBe(8_000);
    const [entry] = await db.revenueShareEntry.findMany({ where: { partnerTenantId: w.tenantId } });
    expect(entry).toMatchObject({ rookShareMinor: 8_000, paidMinor: 13_000 });
    expect(entry!.partnerCommissionMinor + entry!.markupMinor).toBe(5_000);
    expect((await w.payments.catalog(w.actor))?.subscription).toMatchObject({
      planKey: plan,
      state: "active",
    });
  });

  it("does not credit twice when the same event is delivered again, and refuses a forged or stale one", async () => {
    const w = await world("replay");
    const paid = await subscribe(w);
    for (let i = 0; i < 3; i++) expect((await w.deliver(paid)).status).toBe(200);
    expect(await db.creditGrant.count({ where: { partnerTenantId: w.tenantId } })).toBe(1);
    expect(await db.revenueShareEntry.count({ where: { partnerTenantId: w.tenantId } })).toBe(1);

    const forged = await w.deliver(
      { ...paid, id: "evt_forged" },
      Math.floor(NOW.getTime() / 1000) - 3600,
    );
    expect(forged.status).toBe(400);
  });

  it("opens the top-up on the same account with the same fee rule and grants it once from the event", async () => {
    const w = await world("topup");
    await w.deliver(await subscribe(w));
    await w.payments.checkout(w.actor, { kind: "pack", key: pack, quantity: 1 });
    const form = checkoutForm(w);
    expect(form.headers.get("stripe-account")).toBe(w.account);
    expect(form.form).toMatchObject({
      mode: "payment",
      "line_items[0][price_data][unit_amount]": "13000",
      "payment_intent_data[application_fee_amount]": "8000",
      "payment_intent_data[metadata][corvo_pack]": pack,
    });
    // The customer is the one Stripe already knows on the connected account.
    expect(form.form.customer).toBeTruthy();
    expect((await w.balance()).topup.remainingMinor).toBe(0);
    const paid = w.wire.connect.payCheckout(w.account)[0]!;
    await w.deliver(paid);
    await w.deliver(paid);
    expect((await w.balance()).topup.remainingMinor).toBe(5_000);
    expect(
      await db.revenueShareEntry.count({ where: { partnerTenantId: w.tenantId, kind: "topup" } }),
    ).toBe(1);
  });

  it("refuses a top-up before a plan and a second plan checkout while one is in force", async () => {
    const w = await world("refuse");
    await expect(
      w.payments.checkout(w.actor, { kind: "pack", key: pack, quantity: 1 }),
    ).rejects.toMatchObject({ code: "conflict" });
    await w.deliver(await subscribe(w));
    await expect(w.payments.checkout(w.actor, { kind: "plan", key: planUp })).rejects.toMatchObject(
      { code: "conflict" },
    );
    await expect(
      w.payments.checkout(w.actor, { kind: "plan", key: "nope" }),
    ).rejects.toBeInstanceOf(WhiteLabelError);
  });

  it("will not take payment before the partner's account is active", async () => {
    const w = await world("pending", { active: false });
    expect((await w.payments.catalog(w.actor))?.canPay).toBe(false);
    await expect(w.payments.checkout(w.actor, { kind: "plan", key: plan })).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(w.wire.requests.some((r) => r.path === "/v1/checkout/sessions")).toBe(false);
  });

  it("answers as for no one when the caller is not a white label customer", async () => {
    const w = await world("stranger");
    const other: Actor = { ...w.actor, spaceId: "no-such-space" };
    expect(await w.payments.catalog(other)).toBeNull();
    await expect(w.payments.portal(other)).rejects.toMatchObject({ code: "not_customer" });
  });

  it("refunds through Rook: the ledger goes negative and Rook's fee comes back in proportion", async () => {
    const w = await world("refund");
    await w.deliver(await subscribe(w));
    const charge = w.wire.connect.charges[0]!;
    await w.provider.refund({
      account: w.account,
      paymentRef: charge.payment_intent,
      amountMinor: 6_500,
      key: "console-1",
    });
    // The provider hands back the share of the fee by itself on a refund made through Rook.
    expect(w.wire.connect.fees[0]).toMatchObject({ amount: 8_000, amount_refunded: 4_000 });
    const event = w.wire.connect.chargeRefunded(charge.id);
    await w.deliver(event);
    await w.deliver(event);
    const rows = await db.revenueShareEntry.findMany({ where: { partnerTenantId: w.tenantId } });
    expect(rows.find((row) => row.kind === "refund")).toMatchObject({
      rookShareMinor: -4_000,
      paidMinor: -6_500,
    });
    expect(rows.filter((row) => row.kind === "refund")).toHaveLength(1);
    // Ledger and provider agree on Rook's net fee.
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(
      w.wire.connect.fees[0]!.amount - w.wire.connect.fees[0]!.amount_refunded,
    );
  });

  it("follows a refund the partner made in its own dashboard, and returns Rook's fee for it", async () => {
    const w = await world("dash-refund");
    await w.deliver(await subscribe(w));
    const charge = w.wire.connect.charges[0]!;
    w.wire.connect.refundInDashboard(charge.id);
    expect(w.wire.connect.fees[0]!.amount_refunded).toBe(0);
    await w.deliver(w.wire.connect.chargeRefunded(charge.id));
    expect(w.wire.connect.fees[0]!.amount_refunded).toBe(8_000);
    const rows = await db.revenueShareEntry.findMany({ where: { partnerTenantId: w.tenantId } });
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(0);
    expect((await w.balance()).plan.remainingMinor).toBe(0);
  });

  it("goes past due on a failed payment and read-only when unpaid, then recovers when it is paid", async () => {
    const w = await world("pastdue");
    const first = await subscribe(w);
    await w.deliver(first);
    const sub = w.wire.connect.subscriptions[0]!;
    for (const envelope of w.wire.connect.failPayment(sub.id)) await w.deliver(envelope);
    expect(
      (await db.tenantSubscription.findUniqueOrThrow({ where: { partnerTenantId: w.tenantId } }))
        .status,
    ).toBe("past_due");
    expect(await partnerSpaceState(db, w.organizationId, NOW)).toBe("enabled");
    expect(
      await db.partnerWebhookEvent.count({
        where: { partnerId: w.partnerId, kind: "payment.failed" },
      }),
    ).toBe(1);

    await w.deliver(w.wire.connect.setSubscriptionStatus(sub.id, "unpaid"));
    expect(await partnerSpaceState(db, w.organizationId, NOW)).toBe("inactive");
    // Credit lots and the ledger stay as they were: read-only, not erased.
    expect(await db.creditGrant.count({ where: { partnerTenantId: w.tenantId } })).toBe(1);

    const draft = w.wire.connect.renew(sub.id);
    await w.deliver(draft);
    const invoiceRef = w.wire.connect.invoices.at(-1)!.id;
    await w.deliver(w.wire.connect.payInvoice(invoiceRef)[0]!);
    const later = new Date(NOW.getTime() + 30 * 86_400_000);
    expect(await partnerSpaceState(db, w.organizationId, later)).toBe("enabled");
  });

  it("sets Rook's exact fee on a renewal's draft invoice through the webhook", async () => {
    const w = await world("renew");
    await w.deliver(await subscribe(w));
    const sub = w.wire.connect.subscriptions[0]!;
    await w.deliver(w.wire.connect.renew(sub.id));
    const invoice = w.wire.connect.invoices.at(-1)!;
    expect(invoice.feeAmount).toBe(8_000);
    await w.deliver(w.wire.connect.payInvoice(invoice.id)[0]!);
    expect(w.wire.connect.fees.at(-1)!.amount).toBe(8_000);
  });

  it("upgrades through Rook with the new fee, charges the difference and grants it from that payment", async () => {
    const w = await world("upgrade");
    await w.deliver(await subscribe(w));
    expect(await w.payments.changePlan(w.actor, planUp)).toEqual({ effective: "now" });
    const sub = w.wire.connect.subscriptions[0]!;
    expect(sub).toMatchObject({ amount: 23_000, feePercent: 69.57 });
    expect(sub.metadata.corvo_plan).toBe(planUp);
    // Nothing is credited by the request alone.
    expect(await db.creditGrant.count({ where: { partnerTenantId: w.tenantId } })).toBe(1);
    const invoiceRef = w.wire.connect.takeUpdateInvoice();
    if (invoiceRef) await w.deliver(w.wire.connect.payInvoice(invoiceRef)[0]!);
    expect((await w.payments.catalog(w.actor))?.subscription?.planKey).toBe(planUp);
  });

  it("schedules a downgrade for the next period and cancels it when the customer goes back", async () => {
    const w = await world("downgrade");
    await w.payments.checkout(w.actor, { kind: "plan", key: planUp });
    await w.deliver(w.wire.connect.payCheckout(w.account)[0]!);
    expect(await w.payments.changePlan(w.actor, plan)).toEqual({ effective: "period_end" });
    expect((await w.payments.catalog(w.actor))?.subscription).toMatchObject({
      planKey: planUp,
      pendingPlanKey: plan,
    });
    expect(w.wire.connect.takeUpdateInvoice()).toBeUndefined();
    expect(await w.payments.changePlan(w.actor, planUp)).toEqual({ effective: "unchanged" });
    expect((await w.payments.catalog(w.actor))?.subscription?.pendingPlanKey).toBeNull();
  });

  it("opens the billing portal of the connected account for the customer's own card", async () => {
    const w = await world("portal");
    await expect(w.payments.portal(w.actor)).rejects.toMatchObject({ code: "conflict" });
    await w.deliver(await subscribe(w));
    const { url } = await w.payments.portal(w.actor);
    expect(url).toContain("billing.stripe.com");
    const request = w.wire.requests.findLast((r) => r.path === "/v1/billing_portal/sessions")!;
    expect(request.headers.get("stripe-account")).toBe(w.account);
  });

  it("queues the partner's notices once for the events that matter", async () => {
    const w = await world("notices");
    await w.deliver(await subscribe(w));
    expect(w.jobs.enqueue).toHaveBeenCalled();
    const kinds = (
      await db.partnerWebhookEvent.findMany({ where: { partnerId: w.partnerId } })
    ).map((row) => row.kind);
    expect(kinds).toEqual(expect.arrayContaining(["credit.granted", "subscription.updated"]));
  });

  it("makes the first invoice's fee exact too, handing back what the rounded percentage took over", async () => {
    const w = await world("exact");
    await w.payments.checkout(w.actor, { kind: "plan", key: plan });
    // The percentage charged a few centavos more than Rook's share.
    const paid = w.wire.connect.payCheckout(w.account)[0]!;
    w.wire.connect.fees.at(-1)!.amount = 8_007;
    await w.deliver(paid);
    const fee = w.wire.connect.fees.at(-1)!;
    expect(fee.amount - fee.amount_refunded).toBe(8_000);
    await w.deliver(paid);
    expect(fee.amount - fee.amount_refunded).toBe(8_000);
  });

  it("hands Rook's fee back when a dispute is lost, in step with the ledger", async () => {
    const w = await world("lostfee");
    await w.deliver(await subscribe(w));
    const charge = w.wire.connect.charges[0]!;
    const lost = w.wire.connect.dispute(charge.id, "lost");
    await w.deliver(lost);
    await w.deliver(lost);
    const rows = await db.revenueShareEntry.findMany({ where: { partnerTenantId: w.tenantId } });
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(0);
    const fee = w.wire.connect.fees[0]!;
    expect(fee.amount - fee.amount_refunded).toBe(0);
  });
});
