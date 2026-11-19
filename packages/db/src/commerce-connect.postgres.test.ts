import type { NormalizedPaymentEvent } from "@corvo/adapter-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { recordFxRate, seedCatalog } from "./commerce-config.js";
import {
  applyPaymentEvent,
  attachWhiteLabelCustomer,
  priceWhiteLabelPack,
  priceWhiteLabelPlan,
  reconcileApplicationFees,
  whiteLabelCatalog,
} from "./commerce-connect.js";
import { commerceBalance } from "./commerce-ledger.js";
import { partnerSpaceState, provisionPartnerTenant } from "./partner-tenants.js";
import { configurePartnerCommerce, createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const START = new Date("2026-11-01T00:00:00Z");
const END = new Date("2026-12-01T00:00:00Z");
const NOW = new Date("2026-11-10T12:00:00Z");

describePostgres("white label payments (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`.replaceAll("-", "");
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  const plan = `wl_base_${suffix}`;
  const planUp = `wl_up_${suffix}`;
  const pack = `wl_pack_${suffix}`;

  /** A white label partner with a connected account, a 30 markup on the base plan, one customer. */
  async function setup(label: string, currency: "BRL" | "USD" = "BRL") {
    const slug = `wl-${label}-${suffix}`.toLowerCase();
    const { partner } = await createPartner(db, { slug, name: label });
    await configurePartnerCommerce(db, slug, {
      mode: "white_label",
      billingModel: "commerce",
      country: currency === "BRL" ? "BR" : "US",
      commissionBps: 2000,
    });
    const account = `acct_${label}_${suffix}`;
    await db.partner.update({
      where: { id: partner.id },
      data: {
        connectAccountId: account,
        connectState: "active",
        webhookUrl: "https://hooks.example.test/rook",
      },
    });
    await db.partnerMarkup.create({
      data: { partnerId: partner.id, itemKind: "plan", itemKey: plan, kind: "fixed", value: 3000 },
    });
    partnerIds.push(partner.id);
    const made = await provisionPartnerTenant(db, partner, {
      externalTenantId: `org-${label}`,
      name: label,
    });
    organizationIds.push(made.organizationId);
    userIds.push(made.ownerUserId);
    return { partnerId: partner.id, account, tenantId: made.tenantId, org: made.organizationId };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;
  const paid = (
    s: Setup,
    over: Partial<Extract<NormalizedPaymentEvent, { type: "subscription.paid" }>> = {},
  ): NormalizedPaymentEvent => ({
    type: "subscription.paid",
    eventRef: `evt_${Math.random()}`,
    account: s.account,
    subscriptionRef: `sub_${s.account}`,
    customerRef: `cus_${s.account}`,
    invoiceRef: `in_1_${s.account}`,
    paymentRefs: [`pi_1_${s.account}`, `in_1_${s.account}`],
    amountMinor: 13_000,
    currency: "BRL",
    periodStart: START,
    periodEnd: END,
    reason: "create",
    metadata: { corvo_partner: s.partnerId, corvo_tenant: s.tenantId, corvo_plan: plan },
    ...over,
  });
  const topup = (s: Setup, ref: string, amountMinor = 13_000): NormalizedPaymentEvent => ({
    type: "topup.paid",
    eventRef: `evt_${ref}`,
    account: s.account,
    paymentRefs: [ref],
    customerRef: `cus_${s.account}`,
    amountMinor,
    currency: "BRL",
    metadata: {
      corvo_partner: s.partnerId,
      corvo_tenant: s.tenantId,
      corvo_pack: pack,
      corvo_quantity: "1",
    },
  });

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
          prices: {
            BRL: { amountMinor: 10_000, creditMinor: 4_000 },
            USD: { amountMinor: 10_000, creditMinor: 4_000 },
          },
        },
        {
          key: planUp,
          name: "Up",
          prices: {
            BRL: { amountMinor: 20_000, creditMinor: 9_000 },
            USD: { amountMinor: 20_000, creditMinor: 9_000 },
          },
        },
      ],
      packs: [
        {
          key: pack,
          name: "Pack",
          prices: {
            BRL: { amountMinor: 10_000, creditMinor: 5_000 },
            USD: { amountMinor: 10_000, creditMinor: 5_000 },
          },
        },
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

  it("prices the partner's list in its currency: 130 on a base of 100 takes a fee of 80", async () => {
    const brl = await setup("price-brl");
    const usd = await setup("price-usd", "USD");
    for (const [s, currency] of [
      [brl, "BRL"],
      [usd, "USD"],
    ] as const) {
      const partner = await db.partner.findUniqueOrThrow({ where: { id: s.partnerId } });
      expect(partner.currency).toBe(currency);
      const price = await priceWhiteLabelPlan(db, partner, plan);
      expect(price).toMatchObject({
        currency,
        baseMinor: 10_000,
        markupMinor: 3_000,
        priceMinor: 13_000,
        applicationFeeMinor: 8_000,
        creditMinor: 4_000,
      });
      const list = await whiteLabelCatalog(db, partner);
      expect(list.plans.find((p) => p.key === plan)?.priceMinor).toBe(13_000);
      // A pack carries no markup here, and three of them take three shares.
      const packs = await priceWhiteLabelPack(db, partner, pack, 3);
      expect(packs).toMatchObject({ priceMinor: 30_000, applicationFeeMinor: 24_000 });
    }
  });

  it("grants plan credit only from the verified event, once, however often it is delivered", async () => {
    const s = await setup("grant");
    expect(
      (
        await commerceBalance(
          db,
          { currency: "BRL" },
          { id: s.tenantId, organizationId: s.org },
          NOW,
        )
      ).remainingMinor,
    ).toBe(0);
    const event = paid(s);
    expect((await applyPaymentEvent(db, event, NOW)).status).toBe("applied");
    await applyPaymentEvent(db, event, NOW);
    await applyPaymentEvent(db, paid(s), NOW);

    expect(await db.creditGrant.count({ where: { partnerTenantId: s.tenantId } })).toBe(1);
    const entries = await db.revenueShareEntry.findMany({ where: { partnerTenantId: s.tenantId } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "subscription",
      baseMinor: 10_000,
      rookShareMinor: 8_000,
      partnerCommissionMinor: 2_000,
      markupMinor: 3_000,
      paidMinor: 13_000,
      externalRef: `pi_1_${s.account}`,
    });
    // Partner total is the commission plus the markup: 50 on a 130 charge.
    expect(entries[0]!.partnerCommissionMinor + entries[0]!.markupMinor).toBe(5_000);
    const sub = await db.tenantSubscription.findUniqueOrThrow({
      where: { partnerTenantId: s.tenantId },
    });
    expect(sub).toMatchObject({
      status: "active",
      source: "stripe",
      providerSubscriptionRef: `sub_${s.account}`,
      providerCustomerRef: `cus_${s.account}`,
    });
    const balance = await commerceBalance(
      db,
      { currency: "BRL" },
      { id: s.tenantId, organizationId: s.org },
      NOW,
    );
    expect(balance.plan.grantedMinor).toBe(4_000);
    expect(await partnerSpaceState(db, s.org, NOW)).toBe("enabled");
    // The partner is told once.
    const notices = await db.partnerWebhookEvent.findMany({
      where: { partnerId: s.partnerId, kind: "credit.granted" },
    });
    expect(notices).toHaveLength(1);
  });

  it("grants a top-up once, on the same account, with the same fee rule", async () => {
    const s = await setup("topup");
    await applyPaymentEvent(db, paid(s), NOW);
    const event = topup(s, "pi_topup_1");
    await applyPaymentEvent(db, event, NOW);
    await applyPaymentEvent(db, event, NOW);
    await applyPaymentEvent(db, { ...event, eventRef: "evt_again" }, NOW);
    const entries = await db.revenueShareEntry.findMany({
      where: { partnerTenantId: s.tenantId, kind: "topup" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      baseMinor: 10_000,
      rookShareMinor: 8_000,
      markupMinor: 3_000,
      paidMinor: 13_000,
    });
    const balance = await commerceBalance(
      db,
      { currency: "BRL" },
      { id: s.tenantId, organizationId: s.org },
      NOW,
    );
    expect(balance.topup.remainingMinor).toBe(5_000);
  });

  it("refuses to credit a payment that names another partner or another partner's customer", async () => {
    const a = await setup("iso-a");
    const b = await setup("iso-b");
    // An event of B's account that names A's customer.
    const stolen = paid(b, {
      metadata: { corvo_tenant: a.tenantId, corvo_plan: plan },
    });
    expect((await applyPaymentEvent(db, stolen, NOW)).status).toBe("ignored");
    // An event of B's account that says it was for A.
    const wrong = paid(b, {
      metadata: { corvo_partner: a.partnerId, corvo_tenant: b.tenantId, corvo_plan: plan },
    });
    expect((await applyPaymentEvent(db, wrong, NOW)).status).toBe("ignored");
    expect(
      await db.creditGrant.count({ where: { partnerTenantId: { in: [a.tenantId, b.tenantId] } } }),
    ).toBe(0);
    // An account no partner has is no one's.
    expect((await applyPaymentEvent(db, { ...paid(a), account: "acct_nobody" }, NOW)).status).toBe(
      "ignored",
    );
  });

  it("mirrors a failed payment as past due, then read-only once unpaid, and recovers on payment", async () => {
    const s = await setup("fail");
    await applyPaymentEvent(db, paid(s), NOW);
    const failed: NormalizedPaymentEvent = {
      type: "subscription.payment_failed",
      eventRef: "evt_f1",
      account: s.account,
      subscriptionRef: `sub_${s.account}`,
      customerRef: null,
      invoiceRef: "in_2",
      metadata: { corvo_partner: s.partnerId, corvo_tenant: s.tenantId },
    };
    await applyPaymentEvent(db, failed, NOW);
    expect(
      (await db.tenantSubscription.findUniqueOrThrow({ where: { partnerTenantId: s.tenantId } }))
        .status,
    ).toBe("past_due");
    // Past due still runs, for the grace period.
    expect(await partnerSpaceState(db, s.org, NOW)).toBe("enabled");

    const unpaid: NormalizedPaymentEvent = {
      type: "subscription.updated",
      eventRef: "evt_u1",
      account: s.account,
      subscriptionRef: `sub_${s.account}`,
      customerRef: null,
      status: "unpaid",
      periodStart: START,
      periodEnd: END,
      cancelAtPeriodEnd: false,
      metadata: {},
    };
    await applyPaymentEvent(db, unpaid, NOW);
    expect(await partnerSpaceState(db, s.org, NOW)).toBe("inactive");
    // The customer's data and credit lots are untouched.
    expect(await db.creditGrant.count({ where: { partnerTenantId: s.tenantId } })).toBe(1);
    expect(
      await db.partnerWebhookEvent.count({
        where: { partnerId: s.partnerId, kind: { in: ["payment.failed", "subscription.updated"] } },
      }),
    ).toBeGreaterThanOrEqual(2);

    // Paying the next invoice restores access and grants the new period.
    await applyPaymentEvent(
      db,
      paid(s, {
        invoiceRef: "in_3",
        paymentRefs: ["pi_3"],
        reason: "cycle",
        periodStart: END,
        periodEnd: new Date("2027-01-01T00:00:00Z"),
      }),
      new Date("2026-12-02T00:00:00Z"),
    );
    expect(await partnerSpaceState(db, s.org, new Date("2026-12-02T00:00:00Z"))).toBe("enabled");
  });

  it("follows a refund with a negative entry in proportion, once, and takes back unused credit", async () => {
    const s = await setup("refund");
    await applyPaymentEvent(db, paid(s), NOW);
    const refunded = (refundedMinor: number): NormalizedPaymentEvent => ({
      type: "payment.refunded",
      eventRef: `evt_r_${refundedMinor}`,
      account: s.account,
      paymentRefs: [`pi_1_${s.account}`],
      refundedMinor,
      chargeAmountMinor: 13_000,
      applicationFeeRef: "fee_1",
      currency: "BRL",
    });
    const half = await applyPaymentEvent(db, refunded(6_500), NOW);
    expect(half.feeRefund).toEqual({
      applicationFeeRef: "fee_1",
      chargeAmountMinor: 13_000,
      refundedMinor: 6_500,
    });
    await applyPaymentEvent(db, refunded(6_500), NOW);
    await applyPaymentEvent(db, refunded(13_000), NOW);
    await applyPaymentEvent(db, refunded(13_000), NOW);

    const rows = await db.revenueShareEntry.findMany({
      where: { partnerTenantId: s.tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.filter((row) => row.kind === "refund")).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.paidMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.markupMinor, 0)).toBe(0);
    const balance = await commerceBalance(
      db,
      { currency: "BRL" },
      { id: s.tenantId, organizationId: s.org },
      NOW,
    );
    expect(balance.plan.remainingMinor).toBe(0);
    expect(
      await db.partnerWebhookEvent.count({
        where: { partnerId: s.partnerId, kind: "payment.refunded" },
      }),
    ).toBe(2);
  });

  it("records a dispute once, updates its state, and reverses the ledger when it is lost", async () => {
    const s = await setup("dispute");
    await applyPaymentEvent(db, topup(s, "pi_d_0", 13_000), NOW);
    await applyPaymentEvent(db, paid(s), NOW);
    const dispute = (status: string): NormalizedPaymentEvent => ({
      type: "payment.disputed",
      eventRef: `evt_d_${status}`,
      account: s.account,
      disputeRef: `dp_${s.account}`,
      paymentRefs: [`pi_1_${s.account}`],
      amountMinor: 13_000,
      currency: "BRL",
      reason: "fraudulent",
      status,
    });
    await applyPaymentEvent(db, dispute("needs_response"), NOW);
    await applyPaymentEvent(db, dispute("needs_response"), NOW);
    expect(await db.partnerDispute.count({ where: { partnerId: s.partnerId } })).toBe(1);
    expect(
      await db.revenueShareEntry.count({ where: { partnerId: s.partnerId, kind: "refund" } }),
    ).toBe(0);
    await applyPaymentEvent(db, dispute("lost"), NOW);
    await applyPaymentEvent(db, dispute("lost"), NOW);
    expect(
      (await db.partnerDispute.findFirstOrThrow({ where: { partnerId: s.partnerId } })).status,
    ).toBe("lost");
    expect(
      await db.revenueShareEntry.count({ where: { partnerId: s.partnerId, kind: "refund" } }),
    ).toBe(1);
  });

  it("mirrors payouts once and the account's state", async () => {
    const s = await setup("payout");
    const payout: NormalizedPaymentEvent = {
      type: "payout.paid",
      eventRef: "evt_p",
      account: s.account,
      payoutRef: `po_${s.account}`,
      amountMinor: 5_000,
      currency: "BRL",
      arrivedAt: NOW,
    };
    await applyPaymentEvent(db, payout, NOW);
    await applyPaymentEvent(db, payout, NOW);
    expect(await db.partnerPayout.count({ where: { partnerId: s.partnerId } })).toBe(1);

    await applyPaymentEvent(
      db,
      {
        type: "account.updated",
        eventRef: "evt_a",
        account: s.account,
        status: {
          account: s.account,
          state: "restricted",
          chargesEnabled: false,
          payoutsEnabled: false,
          requirementsDue: ["x"],
        },
      },
      NOW,
    );
    expect((await db.partner.findUniqueOrThrow({ where: { id: s.partnerId } })).connectState).toBe(
      "restricted",
    );
  });

  it("sets the renewal fee from the plan about to be charged, never above the invoice", async () => {
    const s = await setup("draft");
    await applyPaymentEvent(db, paid(s), NOW);
    const draft = (
      metadata: Record<string, string>,
      amountDueMinor = 13_000,
    ): NormalizedPaymentEvent => ({
      type: "invoice.draft",
      eventRef: "evt_dr",
      account: s.account,
      invoiceRef: "in_draft",
      subscriptionRef: `sub_${s.account}`,
      amountDueMinor,
      currency: "BRL",
      metadata,
    });
    const base = { corvo_partner: s.partnerId, corvo_tenant: s.tenantId };
    expect((await applyPaymentEvent(db, draft(base), NOW)).invoiceFee).toEqual({
      account: s.account,
      invoiceRef: "in_draft",
      applicationFeeMinor: 8_000,
    });
    // A downgrade is waiting: the renewal is of the other plan.
    expect(
      (await applyPaymentEvent(db, draft({ ...base, corvo_plan: planUp }, 26_000), NOW)).invoiceFee
        ?.applicationFeeMinor,
    ).toBe(16_000);
    expect(
      (await applyPaymentEvent(db, draft(base, 5_000), NOW)).invoiceFee?.applicationFeeMinor,
    ).toBe(5_000);
  });

  it("charges an upgrade's difference and grants its credit once, in the same period", async () => {
    const s = await setup("upgrade");
    await applyPaymentEvent(db, paid(s), NOW);
    const upgrade = paid(s, {
      invoiceRef: "in_up",
      paymentRefs: ["pi_up"],
      amountMinor: 8_000,
      reason: "update",
      periodStart: NOW,
      periodEnd: END,
      metadata: { corvo_partner: s.partnerId, corvo_tenant: s.tenantId, corvo_plan: planUp },
    });
    await applyPaymentEvent(db, upgrade, NOW);
    await applyPaymentEvent(db, upgrade, NOW);
    const grants = await db.creditGrant.findMany({ where: { partnerTenantId: s.tenantId } });
    expect(grants.map((grant) => grant.kind).sort()).toEqual(["plan", "plan_upgrade"]);
    const sub = await db.tenantSubscription.findUniqueOrThrow({
      where: { partnerTenantId: s.tenantId },
    });
    expect(sub.planKey).toBe(planUp);
    // The period did not restart: the plan's credit was not given twice.
    expect(sub.periodStart.toISOString()).toBe(START.toISOString());
  });

  it("compares the ledger with the provider's fees per partner", async () => {
    const s = await setup("recon");
    await applyPaymentEvent(db, paid(s), NOW);
    await applyPaymentEvent(db, topup(s, "pi_recon"), NOW);
    const rows = await reconcileApplicationFees(db, "2026-11", [
      { account: s.account, currency: "BRL", amountMinor: 8_000, refundedMinor: 0 },
      { account: s.account, currency: "BRL", amountMinor: 8_005, refundedMinor: 0 },
    ]);
    expect(rows.find((row) => row.partnerId === s.partnerId)).toMatchObject({
      ledgerMinor: 16_000,
      providerMinor: 16_005,
      differenceMinor: 5,
    });
  });

  it("attaches a signed-up organization to the partner once and never moves it", async () => {
    const a = await setup("attach-a");
    const b = await setup("attach-b");
    await expect(
      attachWhiteLabelCustomer(db, b.partnerId, {
        organizationId: a.org,
        ownerUserId: "someone",
      }),
    ).rejects.toThrow("customer_of_another_partner");
    const same = await attachWhiteLabelCustomer(db, a.partnerId, {
      organizationId: a.org,
      ownerUserId: "someone",
    });
    expect(same.id).toBe(a.tenantId);
  });
});
