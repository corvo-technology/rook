import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { partnerBalanceForOrganization } from "./commerce-account.js";
import type { CatalogSeed } from "./commerce-config.js";
import { recordFxRate, seedCatalog } from "./commerce-config.js";
import { requestHash, runIdempotent } from "./commerce-idempotency.js";
import { draftPartnerInvoices, setPartnerInvoiceState } from "./commerce-invoices.js";
import {
  addTenantTopup,
  CommerceError,
  commerceBalance,
  commerceUsage,
  refundTenantPayment,
  setTenantSubscription,
} from "./commerce-ledger.js";
import { claimCommerceNotices } from "./commerce-notices.js";
import { reserveModelCredits, settleModelCredits } from "./model-credits.js";
import { findPartnerTenant, partnerSpaceState, provisionPartnerTenant } from "./partner-tenants.js";
import { configurePartnerCommerce, createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const CATALOG = JSON.parse(
  readFileSync(
    new URL("../../../apps/api/src/commerce-catalog.example.json", import.meta.url),
    "utf8",
  ),
) as CatalogSeed;

const START = new Date("2026-11-01T00:00:00Z");
const END = new Date("2026-12-01T00:00:00Z");
const NOW = new Date("2026-11-10T12:00:00Z");

describePostgres("partner commerce (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  /** A commerce partner, and one customer. */
  async function setup(label: string, options: { country?: string; webhook?: boolean } = {}) {
    const slug = `c-${label}-${suffix}`.toLowerCase();
    const { partner } = await createPartner(db, { slug, name: label });
    const configured = await configurePartnerCommerce(db, slug, {
      billingModel: "commerce",
      country: options.country ?? "BR",
      commissionBps: 2000,
      scopes: ["tenants:write", "commerce:read", "commerce:write"],
      checkoutUrl: "https://shop.example.test/buy",
    });
    if (options.webhook) {
      await db.partner.update({
        where: { id: partner.id },
        data: { webhookUrl: "https://hooks.example.test/rook" },
      });
      configured.webhookUrl = "https://hooks.example.test/rook";
    }
    partnerIds.push(partner.id);
    const tenant = async (external: string) => {
      const made = await provisionPartnerTenant(db, partner, {
        externalTenantId: external,
        name: external,
      });
      organizationIds.push(made.organizationId);
      userIds.push(made.ownerUserId);
      return {
        id: made.tenantId,
        organizationId: made.organizationId,
        externalTenantId: external,
        state: "enabled",
      };
    };
    return { partner: configured, tenant, slug };
  }

  const subscribe = (
    s: Awaited<ReturnType<typeof setup>>,
    tenant: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["tenant"]>>,
    key: string,
    over: Partial<Parameters<typeof setTenantSubscription>[3]> = {},
    now = NOW,
  ) =>
    setTenantSubscription(
      db,
      s.partner,
      tenant,
      {
        plan: "team",
        status: "active",
        currentPeriodStart: START,
        currentPeriodEnd: END,
        chargedMinor: 54900,
        idempotencyKey: key,
        ...over,
      },
      now,
    );

  const spend = async (organizationId: string, usd: number, now = NOW) => {
    const id = await reserveModelCredits(db, organizationId, usd, undefined, now);
    await settleModelCredits(db, id, usd, now);
  };

  beforeAll(async () => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
    await seedCatalog(db, CATALOG);
    await recordFxRate(db, {
      quote: "BRL",
      rate: "5.12",
      source: "test",
      validFrom: new Date("2026-10-30T00:00:00Z"),
    });
  });
  afterAll(async () => {
    await db.partnerInvoice.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.revenueShareEntry.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it("AC1: a BRL customer on Team reads the plan's credit in BRL and runs against it", async () => {
    const s = await setup("ac1");
    const t = await s.tenant("clinic-1");
    const done = await subscribe(s, t, "k1");
    expect(done.body).toMatchObject({
      plan: "team",
      status: "active",
      period: "2026-11",
      credit: { currency: "BRL", grantedMinor: 20000, usedMinor: 0, remainingMinor: 20000 },
      rookShareMinor: 39920,
    });
    // R$ 200 at 5.12 less the 3% spread: US$ 37.890625 of AI.
    const lot = await db.creditGrant.findFirstOrThrow({ where: { partnerTenantId: t.id } });
    expect(lot.creditMicros).toBe(37_890_625n);
    expect(lot.fxRate).toBe("5.12000000");
    await spend(t.organizationId, 1);
    const balance = await commerceBalance(db, s.partner, t, NOW);
    expect(balance.plan.usedMinor).toBe(527);
    expect(balance.plan.remainingMinor).toBe(19472);
    expect(balance.fxRate).toBe("5.12000000");
    expect(await partnerSpaceState(db, t.organizationId, NOW)).toBe("enabled");
  });

  it("AC2: the same subscription under a new key, or the same key twice, changes nothing", async () => {
    const s = await setup("ac2");
    const t = await s.tenant("clinic-2");
    await subscribe(s, t, "k1");
    await subscribe(s, t, "k1");
    await subscribe(s, t, "k2");
    expect(await db.creditGrant.count({ where: { partnerTenantId: t.id } })).toBe(1);
    expect(await db.revenueShareEntry.count({ where: { partnerTenantId: t.id } })).toBe(1);
    const topup = {
      pack: "pack_s",
      quantity: 1,
      paidMinor: 5500,
      externalPaymentId: "pay_1",
      idempotencyKey: "pay_1",
    };
    const first = await addTenantTopup(db, s.partner, t, topup, NOW);
    const again = await addTenantTopup(db, s.partner, t, topup, NOW);
    expect(again.body.topupId).toBe(first.body.topupId);
    expect(await db.creditGrant.count({ where: { partnerTenantId: t.id, kind: "topup" } })).toBe(1);
    expect((await commerceBalance(db, s.partner, t, NOW)).topup.remainingMinor).toBe(5000);
  });

  it("AC2: a replayed key answers the first answer; another body under the key is refused", async () => {
    const s = await setup("ac2b");
    let runs = 0;
    const run = async () => {
      runs += 1;
      return { status: 201, body: { n: runs } };
    };
    const hash = requestHash("POST /topups", { pack: "pack_s", quantity: 1 });
    const first = await runIdempotent(db, s.partner.id, "key-1", hash, run, NOW);
    const second = await runIdempotent(db, s.partner.id, "key-1", hash, run, NOW);
    const other = await runIdempotent(
      db,
      s.partner.id,
      "key-1",
      requestHash("POST /topups", { pack: "pack_m" }),
      run,
      NOW,
    );
    expect(first).toEqual({ kind: "ran", status: 201, body: { n: 1 } });
    expect(second).toEqual({ kind: "replay", status: 200, body: { n: 1 } });
    expect(other).toEqual({ kind: "conflict" });
    expect(runs).toBe(1);
    // A refusal is not remembered, so the partner can fix the cause and repeat the key.
    const refused = await runIdempotent(
      db,
      s.partner.id,
      "key-2",
      hash,
      async () => ({ status: 409, body: { error: "x" } }),
      NOW,
    );
    expect(refused.kind).toBe("ran");
    const retried = await runIdempotent(db, s.partner.id, "key-2", hash, run, NOW);
    expect(retried).toMatchObject({ kind: "ran", status: 201 });
    // The same key under another partner is another call.
    const s2 = await setup("ac2c");
    expect(await runIdempotent(db, s2.partner.id, "key-1", hash, run, NOW)).toMatchObject({
      kind: "ran",
    });
  });

  it("AC3: base 100 with a markup of 30 keeps Rook 80, commission 20, markup 30", async () => {
    const s = await setup("ac3", { country: "US" });
    const t = await s.tenant("shop-3");
    // Plan priced at 99.00 in USD; the customer paid 129.00 (markup 30.00).
    await subscribe(s, t, "k1", { chargedMinor: 12900 });
    const entry = await db.revenueShareEntry.findFirstOrThrow({ where: { partnerTenantId: t.id } });
    expect(entry).toMatchObject({
      baseMinor: 9900,
      rookShareMinor: 7920,
      partnerCommissionMinor: 1980,
      markupMinor: 3000,
      paidMinor: 12900,
      currency: "USD",
    });
    expect(entry.rookShareMinor + entry.partnerCommissionMinor).toBe(entry.baseMinor);
    // In USD the credit is exact: US$ 40.00.
    expect(
      (await db.creditGrant.findFirstOrThrow({ where: { partnerTenantId: t.id } })).creditMicros,
    ).toBe(40_000_000n);
  });

  it("AC4: plan credit is used first, the top-up survives the period end and the plan credit expires", async () => {
    const s = await setup("ac4", { webhook: true });
    const t = await s.tenant("clinic-4");
    await subscribe(s, t, "k1");
    await addTenantTopup(
      db,
      s.partner,
      t,
      {
        pack: "pack_s",
        quantity: 1,
        paidMinor: 5500,
        externalPaymentId: "p1",
        idempotencyKey: "p1",
      },
      NOW,
    );
    // 31 of the 37.89 plan dollars: the top-up is untouched, and the 80% line is crossed.
    await spend(t.organizationId, 31);
    let balance = await commerceBalance(db, s.partner, t, NOW);
    expect(balance.topup.remainingMinor).toBe(5000);
    expect(balance.lowThresholdReached).toBe(true);
    // One credit.low for the period, however often the sweep runs.
    const first = await claimCommerceNotices(db, NOW);
    const second = await claimCommerceNotices(db, NOW);
    const low = await db.partnerWebhookEvent.findMany({
      where: { partnerId: s.partner.id, kind: "tenant.allowance_low" },
    });
    expect(low).toHaveLength(1);
    expect(low[0]!.payload).toMatchObject({
      period: "2026-11",
      currency: "BRL",
      grantedMinor: 20000,
    });
    expect(first.length).toBeGreaterThanOrEqual(1);
    expect(second.filter((id) => id === low[0]!.id)).toHaveLength(0);
    // Spending past the plan credit reaches the top-up.
    await spend(t.organizationId, 10);
    balance = await commerceBalance(db, s.partner, t, NOW);
    expect(balance.plan.remainingMinor).toBe(0);
    expect(balance.topup.remainingMinor).toBeLessThan(5000);
    // After the period ends the plan credit is gone and the top-up remains.
    const later = new Date("2026-12-02T00:00:00Z");
    const after = await commerceBalance(db, s.partner, t, later);
    expect(after.plan.remainingMinor).toBe(0);
    expect(after.topup.remainingMinor).toBe(balance.topup.remainingMinor);
    await claimCommerceNotices(db, later);
    const expired = await db.partnerWebhookEvent.findMany({
      where: { partnerId: s.partner.id, kind: "credit.expired" },
    });
    expect(expired).toHaveLength(0); // everything of the plan lot was used
  });

  it("AC4: unused plan credit expires and is reported once", async () => {
    const s = await setup("ac4b", { webhook: true });
    const t = await s.tenant("clinic-4b");
    await subscribe(s, t, "k1");
    await spend(t.organizationId, 1);
    const later = new Date("2026-12-02T00:00:00Z");
    expect((await commerceBalance(db, s.partner, t, later)).plan.remainingMinor).toBe(0);
    await claimCommerceNotices(db, later);
    await claimCommerceNotices(db, later);
    const expired = await db.partnerWebhookEvent.findMany({
      where: { partnerId: s.partner.id, kind: "credit.expired" },
    });
    expect(expired).toHaveLength(1);
    expect(expired[0]!.payload).toMatchObject({
      period: "2026-11",
      currency: "BRL",
      expiredMinor: 19472,
    });
  });

  it("AC4: the checkout link carries the customer and the pack", async () => {
    const s = await setup("ac4c");
    const t = await s.tenant("clinic 4c");
    await subscribe(s, t, "k1");
    const view = await partnerBalanceForOrganization(db, t.organizationId, {
      pack: "pack_s",
      now: NOW,
    });
    expect(view?.checkoutUrl).toBe("https://shop.example.test/buy?tenant=clinic+4c&pack=pack_s");
    expect(view).toMatchObject({
      currency: "BRL",
      planName: "Team",
      planCredit: 20000,
      state: "active",
    });
  });

  it("AC5: past_due keeps access for the grace period, then runs are refused until active again", async () => {
    const s = await setup("ac5", { webhook: true });
    const t = await s.tenant("clinic-5");
    await subscribe(s, t, "k1");
    await subscribe(s, t, "k2", { status: "past_due" }, NOW);
    const inGrace = new Date("2026-11-16T00:00:00Z");
    const afterGrace = new Date("2026-11-18T00:00:00Z");
    expect(await partnerSpaceState(db, t.organizationId, inGrace)).toBe("enabled");
    expect(await partnerSpaceState(db, t.organizationId, afterGrace)).toBe("inactive");
    await claimCommerceNotices(db, afterGrace);
    await claimCommerceNotices(db, afterGrace);
    expect(
      await db.partnerWebhookEvent.count({
        where: { partnerId: s.partner.id, kind: "subscription.lapsed" },
      }),
    ).toBe(1);
    await expect(
      addTenantTopup(
        db,
        s.partner,
        t,
        {
          pack: "pack_s",
          quantity: 1,
          paidMinor: 5500,
          externalPaymentId: "p9",
          idempotencyKey: "p9",
        },
        afterGrace,
      ),
    ).rejects.toMatchObject({ code: "plan_inactive" });
    await subscribe(s, t, "k3", { status: "active" }, afterGrace);
    expect(await partnerSpaceState(db, t.organizationId, afterGrace)).toBe("enabled");
    expect(
      (await db.tenantSubscription.findFirstOrThrow({ where: { partnerTenantId: t.id } })).lapsedAt,
    ).toBeNull();
  });

  it("refuses a customer with no plan, and a renewal that never came", async () => {
    const s = await setup("ac5b");
    const t = await s.tenant("clinic-5b");
    expect(await partnerSpaceState(db, t.organizationId, NOW)).toBe("inactive");
    await subscribe(s, t, "k1");
    expect(await partnerSpaceState(db, t.organizationId, new Date("2026-12-05T00:00:00Z"))).toBe(
      "enabled",
    );
    expect(await partnerSpaceState(db, t.organizationId, new Date("2026-12-09T00:00:00Z"))).toBe(
      "inactive",
    );
  });

  it("AC6: a refund reverses the share and removes only the credit still unused", async () => {
    const s = await setup("ac6");
    const t = await s.tenant("clinic-6");
    await subscribe(s, t, "k1");
    const topup = {
      pack: "pack_s",
      quantity: 1,
      paidMinor: 5500,
      externalPaymentId: "pay-6",
      idempotencyKey: "pay-6",
    };
    await addTenantTopup(db, s.partner, t, topup, NOW);
    // Use all of the plan credit and a little of the top-up, then refund the whole payment.
    await spend(t.organizationId, 37.890625 + 1);
    const before = await commerceBalance(db, s.partner, t, NOW);
    expect(before.topup.remainingMinor).toBeLessThan(5000);
    const refund = await refundTenantPayment(
      db,
      s.partner,
      t,
      { externalPaymentId: "pay-6", idempotencyKey: "r1" },
      NOW,
    );
    expect(refund.body.reversed).toEqual({
      baseMinor: 5000,
      rookShareMinor: 4000,
      partnerCommissionMinor: 1000,
      markupMinor: 500,
    });
    expect(refund.body.refundedMinor).toBe(5500);
    const after = await commerceBalance(db, s.partner, t, NOW);
    expect(after.topup.remainingMinor).toBe(0);
    // What was spent stays spent: plan usage is untouched.
    expect(after.plan.usedMinor).toBe(before.plan.usedMinor);
    // The ledger nets to zero for the payment, and the same key refunds once.
    await refundTenantPayment(
      db,
      s.partner,
      t,
      { externalPaymentId: "pay-6", idempotencyKey: "r1" },
      NOW,
    );
    const rows = await db.revenueShareEntry.findMany({
      where: { partnerTenantId: t.id, externalRef: "pay-6" },
    });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.paidMinor, 0)).toBe(0);
    // A second, different refund of the same payment is refused.
    await expect(
      refundTenantPayment(
        db,
        s.partner,
        t,
        { externalPaymentId: "pay-6", idempotencyKey: "r2" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "refund_exceeds" });
    await expect(
      refundTenantPayment(
        db,
        s.partner,
        t,
        { externalPaymentId: "nope", idempotencyKey: "r3" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "unknown_payment" });
  });

  it("AC6: partial refunds add up to the whole, with no rounding left over", async () => {
    const s = await setup("ac6b");
    const t = await s.tenant("clinic-6b");
    await subscribe(s, t, "k1");
    await addTenantTopup(
      db,
      s.partner,
      t,
      {
        pack: "pack_s",
        quantity: 1,
        paidMinor: 5500,
        externalPaymentId: "pay-b",
        idempotencyKey: "pay-b",
      },
      NOW,
    );
    for (const [key, amount] of [
      ["a", 1111],
      ["b", 2222],
      ["c", 2167],
    ] as const) {
      await refundTenantPayment(
        db,
        s.partner,
        t,
        { externalPaymentId: "pay-b", amountMinor: amount, idempotencyKey: key },
        NOW,
      );
    }
    const rows = await db.revenueShareEntry.findMany({
      where: { partnerTenantId: t.id, externalRef: "pay-b" },
    });
    expect(rows.reduce((sum, row) => sum + row.baseMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.rookShareMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.partnerCommissionMinor, 0)).toBe(0);
    expect(rows.reduce((sum, row) => sum + row.markupMinor, 0)).toBe(0);
    expect((await commerceBalance(db, s.partner, t, NOW)).topup.remainingMinor).toBe(0);
  });

  it("prorates an upgrade into one more lot and waits to apply a downgrade", async () => {
    const s = await setup("up");
    const t = await s.tenant("clinic-up");
    await subscribe(s, t, "k1", { plan: "personal", chargedMinor: 14900 });
    const change = new Date("2026-11-21T09:00:00Z");
    const up = await subscribe(s, t, "k2", { plan: "team", chargedMinor: 49900 }, change);
    // 10 of 30 days left: (20000 - 5000) credit and (49900 - 14900) base, a third of each.
    expect(up.body.credit.grantedMinor).toBe(5000 + 5000);
    const entry = await db.revenueShareEntry.findFirstOrThrow({
      where: { partnerTenantId: t.id, source: { contains: ":upg:" } },
    });
    expect(entry).toMatchObject({
      baseMinor: 11666,
      rookShareMinor: 9332,
      partnerCommissionMinor: 2334,
    });
    // A repeat under another key adds nothing.
    await subscribe(s, t, "k3", { plan: "team", chargedMinor: 49900 }, change);
    expect(await db.creditGrant.count({ where: { partnerTenantId: t.id } })).toBe(2);
    const down = await subscribe(s, t, "k4", { plan: "personal", chargedMinor: 14900 }, change);
    expect(down.body.plan).toBe("team");
    expect(
      (await db.tenantSubscription.findFirstOrThrow({ where: { partnerTenantId: t.id } }))
        .pendingPlanKey,
    ).toBe("personal");
  });

  it("refuses an unknown plan, an older period, a suspended customer and an unknown pack", async () => {
    const s = await setup("refuse");
    const t = await s.tenant("clinic-r");
    await expect(subscribe(s, t, "k1", { plan: "nope" })).rejects.toBeInstanceOf(CommerceError);
    await subscribe(s, t, "k2");
    await expect(
      subscribe(s, t, "k3", {
        currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
        currentPeriodEnd: START,
      }),
    ).rejects.toMatchObject({ code: "stale_period" });
    await expect(
      addTenantTopup(
        db,
        s.partner,
        t,
        { pack: "nope", quantity: 1, paidMinor: 1, externalPaymentId: "x", idempotencyKey: "x" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "unknown_pack" });
    await expect(
      addTenantTopup(
        db,
        s.partner,
        { ...t, state: "suspended" },
        {
          pack: "pack_s",
          quantity: 1,
          paidMinor: 5000,
          externalPaymentId: "y",
          idempotencyKey: "y",
        },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "tenant_suspended" });
    await expect(
      addTenantTopup(
        db,
        s.partner,
        t,
        {
          pack: "pack_s",
          quantity: 100,
          paidMinor: 99_999_999,
          externalPaymentId: "z",
          idempotencyKey: "z",
        },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
  });

  it("reports usage by day, in totals only", async () => {
    const s = await setup("usage");
    const t = await s.tenant("clinic-u");
    await subscribe(s, t, "k1");
    await spend(t.organizationId, 1);
    const usage = await commerceUsage(db, s.partner, t, "2026-11");
    expect(usage.currency).toBe("BRL");
    expect(usage.usedMinor).toBe(527);
    expect(usage.byDay).toHaveLength(1);
    expect(Object.keys(usage.byDay[0]!).sort()).toEqual(["date", "usedMinor"]);
  });

  it("AC8: the draft invoice equals the ledger and lists every customer; a later refund goes to the next one", async () => {
    const s = await setup("inv");
    const a = await s.tenant("clinic-a");
    const b = await s.tenant("clinic-b");
    await subscribe(s, a, "k1");
    await subscribe(s, b, "k2", { plan: "personal", chargedMinor: 14900 });
    await addTenantTopup(
      db,
      s.partner,
      a,
      {
        pack: "pack_s",
        quantity: 1,
        paidMinor: 5000,
        externalPaymentId: "ta",
        idempotencyKey: "ta",
      },
      NOW,
    );
    await draftPartnerInvoices(db, "2026-11");
    await draftPartnerInvoices(db, "2026-11");
    const invoice = await db.partnerInvoice.findFirstOrThrow({
      where: { partnerId: s.partner.id, period: "2026-11" },
      include: { lines: true },
    });
    const ledger = await db.revenueShareEntry.aggregate({
      _sum: { rookShareMinor: true },
      where: { partnerId: s.partner.id },
    });
    expect(invoice.totalMinor).toBe(ledger._sum.rookShareMinor);
    expect(invoice.totalMinor).toBe(39920 + 11920 + 4000);
    expect(new Set(invoice.lines.map((line) => line.partnerTenantId))).toEqual(
      new Set([a.id, b.id]),
    );
    expect(invoice.state).toBe("draft");
    await setPartnerInvoiceState(db, invoice.id, "issued", { now: NOW });
    const issued = await db.partnerInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(issued.state).toBe("issued");
    expect(issued.dueAt?.toISOString()).toBe("2026-11-20T12:00:00.000Z");
    await expect(setPartnerInvoiceState(db, invoice.id, "draft" as never)).rejects.toThrow();
    // A refund made after issuing is a credit line on the next invoice; the issued one is final.
    await refundTenantPayment(
      db,
      s.partner,
      a,
      { externalPaymentId: "ta", idempotencyKey: "rr" },
      new Date("2026-12-03T00:00:00Z"),
    );
    await draftPartnerInvoices(db, "2026-11");
    expect(
      (await db.partnerInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).totalMinor,
    ).toBe(invoice.totalMinor);
    await draftPartnerInvoices(db, "2026-12");
    const next = await db.partnerInvoice.findFirstOrThrow({
      where: { partnerId: s.partner.id, period: "2026-12" },
    });
    expect(next.totalMinor).toBe(-4000);
  });

  it("isolation: a partner sees only its own customers, and a customer only its own balance", async () => {
    const one = await setup("iso1");
    const two = await setup("iso2");
    const a = await one.tenant("shared-name");
    const b = await two.tenant("shared-name");
    await subscribe(one, a, "k1");
    expect(await findPartnerTenant(db, two.partner.id, "shared-name")).toMatchObject({ id: b.id });
    expect(await findPartnerTenant(db, two.partner.id, "other")).toBeNull();
    expect((await commerceBalance(db, two.partner, b, NOW)).plan.grantedMinor).toBe(0);
    expect(
      (await partnerBalanceForOrganization(db, a.organizationId, { now: NOW }))?.planCredit,
    ).toBe(20000);
    expect(
      (await partnerBalanceForOrganization(db, b.organizationId, { now: NOW }))?.planCredit,
    ).toBe(0);
    expect(await partnerBalanceForOrganization(db, "not-an-organization", { now: NOW })).toBeNull();
    // Another partner's ledger never reaches this partner's invoice.
    await draftPartnerInvoices(db, "2026-11");
    const invoices = await db.partnerInvoice.findMany({ where: { partnerId: two.partner.id } });
    expect(invoices).toHaveLength(0);
  });

  it("AC7: a wallet partner is untouched and has no commerce balance", async () => {
    const { partner } = await createPartner(db, {
      slug: `w-${suffix}`.toLowerCase(),
      name: "Wallet",
    });
    partnerIds.push(partner.id);
    expect(partner.billingModel).toBe("wallet");
    expect(partner.scopes).toEqual(["tenants:write"]);
    expect(partner.currency).toBe("USD");
    expect(partner.commissionBps).toBe(2000);
    const made = await provisionPartnerTenant(db, partner, { externalTenantId: "w1", name: "w1" });
    organizationIds.push(made.organizationId);
    userIds.push(made.ownerUserId);
    expect(await partnerBalanceForOrganization(db, made.organizationId)).toBeNull();
    expect(await partnerSpaceState(db, made.organizationId)).toBe("enabled");
  });

  it("fails clearly when a BRL grant has no exchange rate", async () => {
    await db.fxRate.deleteMany({ where: { source: "test-none" } });
    const s = await setup("nofx");
    const t = await s.tenant("clinic-nofx");
    const before = await db.fxRate.findMany({ where: { quote: "BRL" } });
    await db.fxRate.deleteMany({ where: { quote: "BRL" } });
    try {
      await expect(subscribe(s, t, "k1")).rejects.toMatchObject({ code: "fx_unavailable" });
      expect(await db.creditGrant.count({ where: { partnerTenantId: t.id } })).toBe(0);
    } finally {
      await db.fxRate.createMany({ data: before.map(({ id: _id, ...row }) => row) });
    }
  });

  it("locks the rate of the period's first day, not a later one", async () => {
    await recordFxRate(db, {
      quote: "BRL",
      rate: "6.00",
      source: "test",
      validFrom: new Date("2026-11-05T00:00:00Z"),
    });
    const s = await setup("lock");
    const t = await s.tenant("clinic-lock");
    await subscribe(s, t, "k1");
    const grant = await db.creditGrant.findFirstOrThrow({ where: { partnerTenantId: t.id } });
    expect(grant.fxRate).toBe("5.12000000");
    await db.fxRate.deleteMany({
      where: { quote: "BRL", validFrom: new Date("2026-11-05T00:00:00Z") },
    });
  });
});
