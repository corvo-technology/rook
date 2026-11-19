import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { reconcileCreditPurchase } from "./model-credits.js";
import { grantPartnerAllowance } from "./partner-allowance.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { PartnerAllowanceRefused, returnUnusedPartnerAllowance } from "./partner-wallet.js";
import { createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const MICROS_PER_CENT = 10_000n;

describePostgres("partner wallet (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  /** A partner whose owner holds `walletCents` of credit, and one customer. */
  async function setup(label: string, walletCents: number) {
    const id = `${label}-${suffix}`;
    const ownerId = `owner-${id}`;
    const ownerOrg = `org-${id}`;
    await db.user.create({
      data: { id: ownerId, name: label, email: `${id}@example.test`, emailVerified: true },
    });
    await db.organization.create({
      data: { id: ownerOrg, name: label, slug: `w-${id}`, createdAt: new Date() },
    });
    await db.member.create({
      data: {
        id: `m-${id}`,
        organizationId: ownerOrg,
        userId: ownerId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    await db.modelCreditAccount.create({ data: { organizationId: ownerOrg, mode: "credits" } });
    if (walletCents > 0) {
      await reconcileCreditPurchase(db, ownerOrg, { id: `fund-${id}`, amountCents: walletCents });
    }
    const { partner } = await createPartner(db, { slug: `acme-${id}`, name: label });
    await db.partner.update({ where: { id: partner.id }, data: { ownerUserId: ownerId } });
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop:${label}`,
      name: label,
    });
    organizationIds.push(ownerOrg, tenant.organizationId);
    userIds.push(ownerId, tenant.ownerUserId);
    partnerIds.push(partner.id);
    return {
      partnerId: partner.id,
      ownerOrg,
      tenant: {
        organizationId: tenant.organizationId,
        partnerId: partner.id,
        externalTenantId: `shop:${label}`,
      },
    };
  }
  const balance = async (organizationId: string) =>
    (await db.modelCreditAccount.findUniqueOrThrow({ where: { organizationId } })).balanceMicros;

  beforeAll(() => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
  });
  afterAll(async () => {
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  const period = "2099-06";

  it("takes the allowance from the owner's credit and gives it to the customer, once", async () => {
    const s = await setup("once", 1000);
    await grantPartnerAllowance(db, s.tenant, { amountCents: 500, period });
    await grantPartnerAllowance(db, s.tenant, { amountCents: 500, period });
    expect(await balance(s.ownerOrg)).toBe(500n * MICROS_PER_CENT);
    expect(await balance(s.tenant.organizationId)).toBe(500n * MICROS_PER_CENT);
  });

  it("takes only the difference when the allowance is raised, and nothing back when lowered", async () => {
    const s = await setup("raise", 1000);
    await grantPartnerAllowance(db, s.tenant, { amountCents: 300, period });
    await grantPartnerAllowance(db, s.tenant, { amountCents: 800, period });
    await grantPartnerAllowance(db, s.tenant, { amountCents: 100, period });
    expect(await balance(s.ownerOrg)).toBe(200n * MICROS_PER_CENT);
    expect(await balance(s.tenant.organizationId)).toBe(800n * MICROS_PER_CENT);
  });

  it("refuses an allowance the owner's credit cannot cover, and gives the customer nothing", async () => {
    const s = await setup("short", 400);
    await expect(
      grantPartnerAllowance(db, s.tenant, { amountCents: 500, period }),
    ).rejects.toMatchObject({ reason: "wallet" });
    expect(await balance(s.ownerOrg)).toBe(400n * MICROS_PER_CENT);
    expect(await balance(s.tenant.organizationId)).toBe(0n);
    // After adding credit, repeating the same call completes it.
    await reconcileCreditPurchase(db, s.ownerOrg, { id: `more-${suffix}-short`, amountCents: 200 });
    await grantPartnerAllowance(db, s.tenant, { amountCents: 500, period });
    expect(await balance(s.tenant.organizationId)).toBe(500n * MICROS_PER_CENT);
    expect(await balance(s.ownerOrg)).toBe(100n * MICROS_PER_CENT);
  });

  it("never lets two calls at once spend the same credit", async () => {
    const s = await setup("race", 500);
    const other = await provisionPartnerTenant(
      db,
      { id: s.partnerId },
      {
        externalTenantId: "shop:race-2",
        name: "second",
      },
    );
    organizationIds.push(other.organizationId);
    userIds.push(other.ownerUserId);
    const second = {
      ...s.tenant,
      organizationId: other.organizationId,
      externalTenantId: "shop:race-2",
    };
    const results = await Promise.allSettled([
      grantPartnerAllowance(db, s.tenant, { amountCents: 500, period }),
      grantPartnerAllowance(db, second, { amountCents: 500, period }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(s.ownerOrg)).toBe(0n);
  });

  it("enforces the per-customer and the monthly limits", async () => {
    const s = await setup("limits", 5000);
    await db.partner.update({
      where: { id: s.partnerId },
      data: { perTenantLimitCents: 600, monthlyLimitCents: 900 },
    });
    await expect(
      grantPartnerAllowance(db, s.tenant, { amountCents: 700, period }),
    ).rejects.toMatchObject({ reason: "limit" });
    await grantPartnerAllowance(db, s.tenant, { amountCents: 600, period });
    const other = await provisionPartnerTenant(
      db,
      { id: s.partnerId },
      {
        externalTenantId: "shop:limits-2",
        name: "second",
      },
    );
    organizationIds.push(other.organizationId);
    userIds.push(other.ownerUserId);
    const second = {
      ...s.tenant,
      organizationId: other.organizationId,
      externalTenantId: "shop:limits-2",
    };
    await expect(
      grantPartnerAllowance(db, second, { amountCents: 400, period }),
    ).rejects.toBeInstanceOf(PartnerAllowanceRefused);
    await grantPartnerAllowance(db, second, { amountCents: 300, period });
    expect(await balance(s.ownerOrg)).toBe(4100n * MICROS_PER_CENT);
  });

  it("refuses an allowance when the owner has no credit account at all", async () => {
    const s = await setup("noacct", 0);
    await db.modelCreditAccount.delete({ where: { organizationId: s.ownerOrg } });
    await expect(
      grantPartnerAllowance(db, s.tenant, { amountCents: 500, period }),
    ).rejects.toMatchObject({ reason: "wallet" });
    expect(await balance(s.tenant.organizationId)).toBe(0n);
    expect(await db.modelCreditAccount.count({ where: { organizationId: s.ownerOrg } })).toBe(0);
  });

  it("refuses a partner without an owner, which has no credit to pass on", async () => {
    const s = await setup("legacy", 1000);
    await db.partner.update({ where: { id: s.partnerId }, data: { ownerUserId: null } });
    await expect(
      grantPartnerAllowance(db, s.tenant, { amountCents: 500, period }),
    ).rejects.toMatchObject({ reason: "wallet" });
    expect(await balance(s.tenant.organizationId)).toBe(0n);
  });

  it("gives back to the owner what a customer left unused when its month ended, once", async () => {
    const s = await setup("return", 1000);
    // A month long past: the customer's credit expires as soon as it is granted.
    await grantPartnerAllowance(db, s.tenant, { amountCents: 500, period: "2020-01" });
    expect(await balance(s.ownerOrg)).toBe(500n * MICROS_PER_CENT);
    await returnUnusedPartnerAllowance(db);
    await returnUnusedPartnerAllowance(db);
    expect(await balance(s.ownerOrg)).toBe(1000n * MICROS_PER_CENT);
  });
});
