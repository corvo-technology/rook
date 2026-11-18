import type { PartnerPricingConfig } from "@corvo/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { reconcileCreditPurchase } from "./model-credits.js";
import {
  assertPartnerSpendAllowed,
  claimAutoTopups,
  claimPartnerCreditNotices,
  failAutoTopup,
  meterPartnerResources,
  partnerFund,
  setPartnerPlan,
} from "./partner-credit-enforcement.js";
import { publishPartnerPricing } from "./partner-pricing.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

// Test numbers only.
const CONFIG: PartnerPricingConfig = {
  tiers: [
    {
      key: "pro",
      name: "Pro",
      prices: {
        BRL: { priceMinor: 49_900, includedCredits: 2_000 },
        USD: { priceMinor: 9_900, includedCredits: 2_000 },
      },
    },
  ],
  costs: {
    models: {},
    voiceMinuteMicros: 20_000,
    computerMinuteMicros: 10_000,
    storageGbMonthMicros: 100_000,
  },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 1,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

describePostgres("partner credit enforcement (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  const computerRunIds: string[] = [];

  async function setup(label: string, fundCents: number) {
    const id = `${label}-${suffix}`;
    const ownerId = `owner-${id}`;
    const walletOrg = `org-${id}`;
    await db.user.create({
      data: { id: ownerId, name: label, email: `${id}@example.test`, emailVerified: true },
    });
    await db.organization.create({
      data: { id: walletOrg, name: label, slug: `w-${id}`, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id: `m-${id}`,
        organizationId: walletOrg,
        userId: ownerId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await db.modelCreditAccount.create({ data: { organizationId: walletOrg, mode: "credits" } });
    if (fundCents > 0) {
      await reconcileCreditPurchase(db, walletOrg, { id: `fund-${id}`, amountCents: fundCents });
    }
    const { partner } = await createPartner(db, { slug: `acme-${id}`, name: label });
    await db.partner.update({
      where: { id: partner.id },
      data: { ownerUserId: ownerId, mode: "embedded", currency: "BRL" },
    });
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop:${label}`,
      name: label,
    });
    // The customer holds credit of its own to be debited from.
    await db.modelCreditAccount.upsert({
      where: { organizationId: tenant.organizationId },
      create: { organizationId: tenant.organizationId, mode: "credits" },
      update: { mode: "credits" },
    });
    await reconcileCreditPurchase(db, tenant.organizationId, {
      id: `cust-${id}`,
      amountCents: 10_000,
    });
    organizationIds.push(walletOrg, tenant.organizationId);
    userIds.push(ownerId, tenant.ownerUserId);
    partnerIds.push(partner.id);
    return { partnerId: partner.id, walletOrg, customerOrg: tenant.organizationId };
  }

  beforeAll(async () => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
    await publishPartnerPricing(db, CONFIG, null);
  });
  afterAll(async () => {
    await db.computerRun.deleteMany({ where: { id: { in: computerRunIds } } });
    await db.partnerInvoice.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it("starts one auto top-up per crossing and retries a failure after the backoff", async () => {
    const s = await setup("topup", 1000);
    await db.partner.update({
      where: { id: s.partnerId },
      data: {
        autoTopupEnabled: true,
        autoTopupThresholdCredits: 5000,
        autoTopupAmountMinor: 2500,
      },
    });
    const now = new Date();
    const first = (await claimAutoTopups(db, now)).filter((due) => due.partnerId === s.partnerId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ amountMinor: 2500, attempt: 1 });
    const repeat = (await claimAutoTopups(db, now)).filter((due) => due.partnerId === s.partnerId);
    expect(repeat).toEqual([]);

    await failAutoTopup(db, first[0]?.attemptId as string, now);
    const early = new Date(now.getTime() + 5 * 60_000);
    expect((await claimAutoTopups(db, early)).filter((d) => d.partnerId === s.partnerId)).toEqual(
      [],
    );
    const later = new Date(now.getTime() + 20 * 60_000);
    const retry = (await claimAutoTopups(db, later)).filter((d) => d.partnerId === s.partnerId);
    expect(retry).toHaveLength(1);
    expect(retry[0]).toMatchObject({ attempt: 2 });

    // A refill that clears the threshold ends the crossing; a new drop starts a new one.
    await reconcileCreditPurchase(db, s.walletOrg, { id: `refill-${suffix}`, amountCents: 9000 });
    expect((await claimAutoTopups(db, later)).filter((d) => d.partnerId === s.partnerId)).toEqual(
      [],
    );
  });

  it("splits the fund into plan credits that end with the month and top-ups that stay", async () => {
    const s = await setup("fund", 1000);
    const now = new Date();
    await setPartnerPlan(db, s.partnerId, "pro", now);
    const fund = await partnerFund(db, s.partnerId, now);
    expect(fund.planCredits).toBe(2000);
    expect(fund.topupCredits).toBe(1000);
    expect(fund.plan).toMatchObject({ tierKey: "pro", includedCredits: 2000, status: "active" });
    // After the month the plan credits are gone and the top-up remains.
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2));
    const after = await partnerFund(db, s.partnerId, nextMonth);
    expect(after.planCredits).toBe(0);
    expect(after.topupCredits).toBe(1000);
    // The fee is on the month's invoice once, however often the plan is set.
    await setPartnerPlan(db, s.partnerId, "pro", now);
    const invoices = await db.partnerInvoice.findMany({
      where: { partnerId: s.partnerId },
      include: { lines: true },
    });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.totalMinor).toBe(49_900);
    expect(invoices[0]?.lines).toHaveLength(1);
  });

  it("debits ended computer runs and storage above the allowance once", async () => {
    const s = await setup("meter", 1000);
    const space = await db.space.findFirstOrThrow({ where: { organizationId: s.customerOrg } });
    const now = new Date();
    const run = await db.computerRun.create({
      data: {
        computerId: `computer-${suffix}`,
        spaceId: space.id,
        kind: "docker",
        startedAt: new Date(now.getTime() - 3_600_000),
        endedAt: new Date(now.getTime() - 3_000_000),
      },
    });
    computerRunIds.push(run.id);
    await db.storageUsage.upsert({
      where: { organizationId: s.customerOrg },
      create: { organizationId: s.customerOrg, bytes: BigInt(3 * 1024 ** 3) },
      update: { bytes: BigInt(3 * 1024 ** 3) },
    });
    const balance = async () =>
      (await db.modelCreditAccount.findUniqueOrThrow({ where: { organizationId: s.customerOrg } }))
        .balanceMicros;
    const before = await balance();
    await meterPartnerResources(db, now);
    const afterFirst = await balance();
    // 10 minutes at 10,000 micros = 100,000 micros (10 credits); 2 GB over at 100,000 = 20 credits.
    expect(before - afterFirst).toBe(30n * 10_000n);
    await meterPartnerResources(db, now);
    expect(await balance()).toBe(afterFirst);
    const sources = await db.modelCreditEntry.findMany({
      where: { organizationId: s.customerOrg, source: { startsWith: "hold:resource:" } },
      select: { source: true },
    });
    expect(sources.map((row) => row.source.split(":")[2]).sort()).toEqual(["computer", "storage"]);
  });

  it("refuses at the limit and sends the limit notice once", async () => {
    const s = await setup("limit", 1000);
    await db.partnerTenant.update({
      where: { organizationId: s.customerOrg },
      data: { creditLimitCredits: 10 },
    });
    await db.partner.update({
      where: { id: s.partnerId },
      data: { webhookUrl: "https://partner.example.test/hook" },
    });
    const now = new Date();
    await expect(
      assertPartnerSpendAllowed(db, s.customerOrg, { provider: "p", model: "m" }, now),
    ).resolves.toBeUndefined();
    // Spend 10 credits (100,000 micros) as a model call would.
    await db.modelCreditEntry.create({
      data: {
        organizationId: s.customerOrg,
        source: `call:limit-${suffix}`,
        callId: `limit-${suffix}`,
        amountMicros: -100_000n,
        model: "m",
      },
    });
    await expect(
      assertPartnerSpendAllowed(db, s.customerOrg, { provider: "p", model: "m" }, now),
    ).rejects.toMatchObject({ reason: "credit_limit_reached" });
    const mine = async () =>
      (await db.partnerWebhookEvent.findMany({ where: { partnerId: s.partnerId } })).filter(
        (event) => event.kind === "customer.credit_limit_reached",
      );
    await claimPartnerCreditNotices(db, now);
    await claimPartnerCreditNotices(db, now);
    expect(await mine()).toHaveLength(1);
  });
});
