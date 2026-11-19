import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { consumePartnerEntryCode } from "./partner-entry.js";
import { provisionPartnerTenant, setPartnerTenantState } from "./partner-tenants.js";
import { createPartner, setPartnerEnabled } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

describePostgres("partner entry codes (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];
  let counter = 0;

  async function setup(options: { expiresInMs?: number } = {}) {
    const label = `e${++counter}`;
    const { partner } = await createPartner(db, { slug: `acme-${label}-${suffix}`, name: label });
    partnerIds.push(partner.id);
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop-${label}`,
      name: label,
    });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const code = `code-${label}-${suffix}`;
    await db.partnerEntryCode.create({
      data: {
        codeHash: hash(code),
        partnerId: partner.id,
        tenantId: tenant.tenantId,
        externalUserId: "u1",
        expiresAt: new Date(Date.now() + (options.expiresInMs ?? 60_000)),
      },
    });
    return { partner, tenant, code, label };
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

  it("gives the customer's owner once, and nothing the second time", async () => {
    const { tenant, code } = await setup();
    await expect(consumePartnerEntryCode(db, hash(code))).resolves.toMatchObject({
      userId: tenant.ownerUserId,
      externalUserId: "u1",
      role: null,
    });
    await expect(consumePartnerEntryCode(db, hash(code))).resolves.toBeNull();
  });

  it("lets exactly one of several simultaneous uses win", async () => {
    const { code } = await setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumePartnerEntryCode(db, hash(code))),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("refuses an expired code and a code nobody made, and leaves the expired one unused", async () => {
    const { code } = await setup({ expiresInMs: -1000 });
    await expect(consumePartnerEntryCode(db, hash(code))).resolves.toBeNull();
    await expect(consumePartnerEntryCode(db, hash("made-up"))).resolves.toBeNull();
    await expect(
      db.partnerEntryCode.findUniqueOrThrow({ where: { codeHash: hash(code) } }),
    ).resolves.toMatchObject({ usedAt: null });
  });

  it("refuses a code whose customer was suspended after it was made, or whose partner was disabled", async () => {
    const a = await setup();
    await setPartnerTenantState(db, a.partner.id, `shop-${a.label}`, "suspended");
    await expect(consumePartnerEntryCode(db, hash(a.code))).resolves.toBeNull();
    const b = await setup();
    await setPartnerEnabled(db, b.partner.slug, false);
    await expect(consumePartnerEntryCode(db, hash(b.code))).resolves.toBeNull();
  });
});
