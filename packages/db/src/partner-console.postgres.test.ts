import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import type { CatalogSeed } from "./commerce-config.js";
import { recordFxRate, seedCatalog } from "./commerce-config.js";
import { addTenantCredit, CommerceError, setTenantSubscription } from "./commerce-ledger.js";
import { readPartnerMarkups } from "./partner-markup.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { configurePartnerCommerce, createPartner, ensurePartnerMember } from "./partners.js";
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

const NOW = new Date("2026-11-10T12:00:00Z");

describePostgres("partner console (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  async function setup(label: string) {
    const slug = `console-${label}-${suffix}`.toLowerCase();
    const { partner } = await createPartner(db, { slug, name: label });
    const configured = await configurePartnerCommerce(db, slug, {
      billingModel: "commerce",
      country: "BR",
      commissionBps: 2000,
    });
    partnerIds.push(partner.id);
    const made = await provisionPartnerTenant(db, partner, {
      externalTenantId: "clinic-1",
      name: "Clinic",
    });
    organizationIds.push(made.organizationId);
    userIds.push(made.ownerUserId);
    const tenant = {
      id: made.tenantId,
      organizationId: made.organizationId,
      externalTenantId: "clinic-1",
      state: "enabled",
    };
    await setTenantSubscription(
      db,
      configured,
      tenant,
      {
        plan: "team",
        status: "active",
        currentPeriodStart: new Date("2026-11-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-12-01T00:00:00Z"),
        chargedMinor: 54900,
        idempotencyKey: `sub-${label}`,
      },
      NOW,
    );
    return { partner: configured, tenant };
  }

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
    await db.revenueShareEntry.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it("adds credit once per key and bills Rook's cost to the partner as an adjustment", async () => {
    const { partner, tenant } = await setup("credit");
    const first = await addTenantCredit(
      db,
      partner,
      tenant,
      { amountMinor: 2500, idempotencyKey: "gift-1" },
      NOW,
    );
    const again = await addTenantCredit(
      db,
      partner,
      tenant,
      { amountMinor: 2500, idempotencyKey: "gift-1" },
      NOW,
    );
    expect(again.remainingMinor).toBe(first.remainingMinor);
    const other = await addTenantCredit(
      db,
      partner,
      tenant,
      { amountMinor: 2500, idempotencyKey: "gift-2" },
      NOW,
    );
    expect(other.remainingMinor).toBeGreaterThan(first.remainingMinor);
    const entries = await db.revenueShareEntry.findMany({
      where: { partnerId: partner.id, kind: "adjustment" },
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      baseMinor: 2500,
      rookShareMinor: 2500,
      partnerCommissionMinor: 0,
      markupMinor: 0,
      paidMinor: 0,
    });
  });

  it("refuses credit for a paused customer and a customer with no plan", async () => {
    const { partner, tenant } = await setup("refuse");
    await expect(
      addTenantCredit(
        db,
        partner,
        { ...tenant, state: "suspended" },
        { amountMinor: 100, idempotencyKey: "gift-3" },
        NOW,
      ),
    ).rejects.toMatchObject({ code: "tenant_suspended" });
    await expect(
      addTenantCredit(
        db,
        partner,
        tenant,
        { amountMinor: 100, idempotencyKey: "gift-4" },
        new Date("2027-03-01T00:00:00Z"),
      ),
    ).rejects.toBeInstanceOf(CommerceError);
  });

  it("keeps one membership per organization and partner, and reads the markups of one partner", async () => {
    const { partner, tenant } = await setup("members");
    await db.partnerMember.create({
      data: { partnerId: partner.id, organizationId: tenant.organizationId },
    });
    await expect(
      db.partnerMember.create({
        data: { partnerId: partner.id, organizationId: tenant.organizationId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await db.partnerMarkup.create({
      data: {
        partnerId: partner.id,
        itemKind: "plan",
        itemKey: "team",
        kind: "percent",
        value: 1500,
      },
    });
    expect(await readPartnerMarkups(db, partner.id)).toEqual(
      new Map([["plan:team", { kind: "percent", value: 1500 }]]),
    );
    await ensurePartnerMember(db, { id: partner.id });
    expect(await db.partnerMember.count({ where: { partnerId: partner.id } })).toBe(1);
  });
});
