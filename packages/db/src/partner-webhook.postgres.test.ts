import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { grantPartnerAllowance } from "./partner-allowance.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { giveWallet } from "./partner-wallet.test-support.js";
import {
  claimPartnerAllowanceNotices,
  undeliveredPartnerWebhookEvents,
} from "./partner-webhook.js";
import {
  createPartner,
  findUserIdByEmail,
  rotatePartnerWebhookSecret,
  setPartnerTemplateBySlug,
  setPartnerWebhookUrl,
} from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("partner webhooks and templates (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  const NOW = new Date();
  const period = `${NOW.getUTCFullYear()}-${String(NOW.getUTCMonth() + 1).padStart(2, "0")}`;

  async function customer(label: string, options: { webhook?: boolean } = {}) {
    const { partner } = await createPartner(db, { slug: `hook-${label}-${suffix}`, name: label });
    partnerIds.push(partner.id);
    const wallet = await giveWallet(db, partner.id, `${label}-${suffix}`, 100_000);
    organizationIds.push(wallet.organizationId);
    userIds.push(wallet.userId);
    if (options.webhook !== false) {
      await setPartnerWebhookUrl(db, partner.slug, "https://hooks.example.test/rook");
    }
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop-${label}`,
      name: label,
    });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const ref = {
      organizationId: tenant.organizationId,
      partnerId: partner.id,
      externalTenantId: `shop-${label}`,
    };
    await grantPartnerAllowance(db, ref, { amountCents: 1000, period });
    return { ...ref, slug: partner.slug };
  }

  /** Spends cents of the customer's credit the way a run does: one negative entry. */
  async function spend(organizationId: string, cents: number, id: string) {
    await db.$executeRaw`
      INSERT INTO model_credit_entries (id, "organizationId", "amountMicros", source, "createdAt")
      VALUES (${id}, ${organizationId}, ${BigInt(-cents) * 10_000n}, ${`usage:${id}`}, now())`;
    await db.$executeRaw`
      UPDATE model_credit_accounts SET "balanceMicros" = "balanceMicros" - ${BigInt(cents) * 10_000n}
      WHERE "organizationId" = ${organizationId}`;
  }

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

  const mine = (ids: string[], partnerId: string) =>
    db.partnerWebhookEvent.findMany({ where: { id: { in: ids }, partnerId } });

  it("says nothing below 80% of the credit, then once at 80%, and not again", async () => {
    const c = await customer("low");
    await spend(c.organizationId, 790, `${c.partnerId}-a`);
    expect(await mine(await claimPartnerAllowanceNotices(db, NOW), c.partnerId)).toHaveLength(0);

    await spend(c.organizationId, 10, `${c.partnerId}-b`);
    const first = await mine(await claimPartnerAllowanceNotices(db, NOW), c.partnerId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      kind: "tenant.allowance_low",
      externalTenantId: c.externalTenantId,
      period,
      grantedCents: 1000,
      usedCents: 800,
    });
    expect(await mine(await claimPartnerAllowanceNotices(db, NOW), c.partnerId)).toHaveLength(0);
  });

  it("says it again, as exhausted, when the credit runs out, once", async () => {
    const c = await customer("out");
    await spend(c.organizationId, 850, `${c.partnerId}-a`);
    await claimPartnerAllowanceNotices(db, NOW);
    await spend(c.organizationId, 150, `${c.partnerId}-b`);
    const out = await mine(await claimPartnerAllowanceNotices(db, NOW), c.partnerId);
    expect(out.map((row) => row.kind)).toEqual(["tenant.allowance_exhausted"]);
    expect(await mine(await claimPartnerAllowanceNotices(db, NOW), c.partnerId)).toHaveLength(0);
    const all = await db.partnerWebhookEvent.findMany({ where: { partnerId: c.partnerId } });
    expect(all.map((row) => row.kind).sort()).toEqual([
      "tenant.allowance_exhausted",
      "tenant.allowance_low",
    ]);
  });

  it("tells only partners that have a webhook", async () => {
    const c = await customer("quiet", { webhook: false });
    await spend(c.organizationId, 900, `${c.partnerId}-a`);
    await claimPartnerAllowanceNotices(db, NOW);
    expect(await db.partnerWebhookEvent.count({ where: { partnerId: c.partnerId } })).toBe(0);
  });

  it("offers an undelivered notice again after a while, and never a delivered one", async () => {
    const c = await customer("lost");
    await spend(c.organizationId, 900, `${c.partnerId}-a`);
    await claimPartnerAllowanceNotices(db, NOW);
    const row = await db.partnerWebhookEvent.findFirstOrThrow({
      where: { partnerId: c.partnerId },
    });
    const later = new Date(NOW.getTime() + 20 * 60_000);
    expect(await undeliveredPartnerWebhookEvents(db, later)).toContain(row.id);
    // Too soon: the first job is probably still running.
    expect(await undeliveredPartnerWebhookEvents(db, NOW)).not.toContain(row.id);
    await db.partnerWebhookEvent.update({ where: { id: row.id }, data: { deliveredAt: later } });
    expect(await undeliveredPartnerWebhookEvents(db, later)).not.toContain(row.id);
  });

  it("stores a template by slug, the same each time, and reports an unknown slug", async () => {
    const { partner } = await createPartner(db, { slug: `tpl-${suffix}`, name: "Tpl" });
    partnerIds.push(partner.id);
    const template = {
      agents: [],
      chiefName: "Assistente Teste",
      accent: "#16a34a",
      hide: ["store"],
    };
    expect(await setPartnerTemplateBySlug(db, partner.slug, template)).toBe(true);
    expect(await setPartnerTemplateBySlug(db, partner.slug, template)).toBe(true);
    const stored = await db.partner.findUniqueOrThrow({ where: { id: partner.id } });
    expect(stored.template).toEqual(template);
    expect(await setPartnerTemplateBySlug(db, `nobody-${suffix}`, template)).toBe(false);
  });

  it("raises the signing secret's version on rotation and clears the address when off", async () => {
    const { partner } = await createPartner(db, { slug: `rot-${suffix}`, name: "Rot" });
    partnerIds.push(partner.id);
    expect(partner.webhookSecretVersion).toBe(0);
    expect((await rotatePartnerWebhookSecret(db, partner.slug)).webhookSecretVersion).toBe(1);
    expect(
      (await setPartnerWebhookUrl(db, partner.slug, "https://x.example.test/h")).webhookUrl,
    ).toBe("https://x.example.test/h");
    expect((await setPartnerWebhookUrl(db, partner.slug, null)).webhookUrl).toBeNull();
    await expect(rotatePartnerWebhookSecret(db, `nobody-${suffix}`)).rejects.toThrow(/unknown/i);
  });

  it("lets several partners draw on one account's credit through a wallet owner", async () => {
    const first = await customer("w1");
    const owner = await db.partner.findUniqueOrThrow({ where: { id: first.partnerId } });
    const email = `wallet-owner-w1-${suffix}@example.test`;
    expect(owner.ownerUserId).toBe(`wallet-owner-w1-${suffix}`);
    expect(await findUserIdByEmail(db, email.toUpperCase())).toBe(owner.ownerUserId);

    const { partner: second } = await createPartner(db, {
      slug: `w2-${suffix}`,
      name: "Second",
      walletOwnerUserId: owner.ownerUserId!,
    });
    partnerIds.push(second.id);
    const tenant = await provisionPartnerTenant(db, second, { externalTenantId: "s", name: "S" });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const granted = await grantPartnerAllowance(
      db,
      { organizationId: tenant.organizationId, partnerId: second.id, externalTenantId: "s" },
      { amountCents: 500, period },
    );
    expect(granted.addedCents).toBe(500);
  });
});
