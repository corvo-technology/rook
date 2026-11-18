import type { PartnerPricingConfig } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  asSystem,
  createDb,
  createPartner,
  provisionPartnerTenant,
  publishPartnerPricing,
  reconcileCreditPurchase,
  setPartnerPlan,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaPartnerConsoleStore } from "./prisma-store.js";
import type { PartnerRecord } from "./types.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

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
  costs: { models: {}, voiceMinuteMicros: 1, computerMinuteMicros: 1, storageGbMonthMicros: 1 },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 1,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

dbTests("partner credit usage split (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let connection: ReturnType<typeof createDb>;
  let db: PrismaClient;
  const partnerIds: string[] = [];
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    connection = createDb(process.env.DATABASE_URL as string);
    db = asSystem(connection.prisma);
    await publishPartnerPricing(db, CONFIG, null);
  });
  afterAll(async () => {
    await db.partnerInvoice.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await connection.prisma.$disconnect();
    await connection.pool.end();
  });

  it("reports credits per model, voice, computer and storage, and the plan and top-up fund", async () => {
    const id = `usage-${suffix}`;
    const ownerId = `owner-${id}`;
    const walletOrg = `org-${id}`;
    await db.user.create({
      data: { id: ownerId, name: id, email: `${id}@example.test`, emailVerified: true },
    });
    await db.organization.create({
      data: { id: walletOrg, name: id, slug: `w-${id}`, createdAt: new Date() },
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
    await reconcileCreditPurchase(db, walletOrg, { id: `fund-${id}`, amountCents: 1000 });
    const { partner } = await createPartner(db, { slug: `acme-${id}`, name: id });
    await db.partner.update({
      where: { id: partner.id },
      data: { ownerUserId: ownerId, mode: "embedded", currency: "BRL" },
    });
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop:${id}`,
      name: id,
    });
    partnerIds.push(partner.id);
    organizationIds.push(walletOrg, tenant.organizationId);
    userIds.push(ownerId, tenant.ownerUserId);
    const now = new Date();
    await setPartnerPlan(db, partner.id, "pro", now);

    await db.modelCreditAccount.upsert({
      where: { organizationId: tenant.organizationId },
      create: { organizationId: tenant.organizationId, mode: "credits" },
      update: {},
    });
    const spend = (source: string, credits: number, model?: string) =>
      db.modelCreditEntry.create({
        data: {
          organizationId: tenant.organizationId,
          source,
          amountMicros: -BigInt(credits) * 10_000n,
          ...(model ? { model } : {}),
        },
      });
    await spend(`call:a-${suffix}`, 20, "model-a");
    await spend(`call:b-${suffix}`, 10, "model-a");
    await spend(`call:c-${suffix}`, 7, "model-b");
    await spend(`hold:resource:voice:${tenant.organizationId}:k-${suffix}`, 5);
    await spend(`hold:resource:computer:${tenant.organizationId}:k-${suffix}`, 3);
    await spend(`hold:resource:storage:${tenant.organizationId}:2026-10`, 2);

    const record = { id: partner.id } as PartnerRecord;
    const usage = await createPrismaPartnerConsoleStore(connection.prisma).creditUsage(record, now);
    const customer = usage.customers.find((row) => row.tenantId === tenant.tenantId);
    expect(customer?.byResource).toEqual({
      "model-a": 30,
      "model-b": 7,
      voice: 5,
      computer: 3,
      storage: 2,
    });
    expect(customer?.usedCredits).toBe(47);
    expect(usage.planCredits).toBe(2000);
    expect(usage.topupCredits).toBe(1000);
    expect(usage.plan).toMatchObject({ tierKey: "pro", includedCredits: 2000 });
  });
});
