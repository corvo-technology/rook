import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { createPrismaBrandingStore, HostnameTakenError } from "./partner-brand.js";
import { createPartner } from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("white label brand storage (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const partnerIds: string[] = [];
  const organizationIds: string[] = [];

  async function whiteLabel(label: string) {
    const { partner } = await createPartner(db, { slug: `brand-${label}-${suffix}`, name: label });
    await db.partner.update({ where: { id: partner.id }, data: { mode: "white_label" } });
    partnerIds.push(partner.id);
    return partner.id;
  }
  async function organization(label: string) {
    const id = `brand-org-${label}-${suffix}`;
    await db.organization.create({
      data: { id, name: label, slug: id, createdAt: new Date() },
    });
    organizationIds.push(id);
    return id;
  }
  const look = (appName: string) => ({
    appName,
    accent: "#2563eb",
    supportEmail: null,
    termsUrl: "https://acme.example.test/terms",
    privacyUrl: "https://acme.example.test/privacy",
  });

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
    await db.partnerCustomer.deleteMany({ where: { partnerId: { in: partnerIds } } });
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await close();
  });

  it("serves a brand only for an active host of an enabled white label partner", async () => {
    const store = createPrismaBrandingStore(prisma);
    const partnerId = await whiteLabel("host");
    const hostname = `app-${suffix}.acme.example.test`;
    await store.saveBrand(partnerId, look("Acme"));
    const host = await store.createDomain({ partnerId, hostname, providerId: "ch-1" });
    expect(await store.hostBrand(hostname)).toBeNull();
    await store.updateDomain(host.id, { state: "active" });
    expect((await store.hostBrand(hostname))?.brand.appName).toBe("Acme");
    await db.partner.update({ where: { id: partnerId }, data: { enabled: false } });
    expect(await store.hostBrand(hostname)).toBeNull();
    await db.partner.update({
      where: { id: partnerId },
      data: { enabled: true, mode: "embedded" },
    });
    expect(await store.hostBrand(hostname)).toBeNull();
    expect(await store.hostBrand(`other-${suffix}.example.test`)).toBeNull();
  });

  it("gives a hostname to one partner only", async () => {
    const store = createPrismaBrandingStore(prisma);
    const first = await whiteLabel("first");
    const second = await whiteLabel("second");
    const hostname = `shared-${suffix}.example.test`;
    await store.createDomain({ partnerId: first, hostname, providerId: "ch-1" });
    expect(await store.hostnameTaken(hostname)).toBe(true);
    await expect(
      store.createDomain({ partnerId: second, hostname, providerId: "ch-2" }),
    ).rejects.toBeInstanceOf(HostnameTakenError);
  });

  it("links a customer once and never lets the link move to another partner", async () => {
    const store = createPrismaBrandingStore(prisma);
    const first = await whiteLabel("link-a");
    const second = await whiteLabel("link-b");
    const orgId = await organization("customer");
    expect(
      await store.linkCustomer({
        partnerId: first,
        organizationId: orgId,
        hostname: "a.example.test",
      }),
    ).toBe(true);
    expect(
      await store.linkCustomer({
        partnerId: second,
        organizationId: orgId,
        hostname: "b.example.test",
      }),
    ).toBe(false);
    expect(await store.customerCount(first)).toBe(1);
    expect(await store.customerCount(second)).toBe(0);
    // Even a direct write cannot point the customer somewhere else.
    await expect(
      db.partnerCustomer.update({ where: { organizationId: orgId }, data: { partnerId: second } }),
    ).rejects.toThrow();
    await expect(
      db.partnerCustomer.update({
        where: { organizationId: orgId },
        data: { hostname: "c.example.test" },
      }),
    ).rejects.toThrow();
  });

  it("finds the brand of the partner a customer signed up through", async () => {
    const store = createPrismaBrandingStore(prisma);
    const partnerId = await whiteLabel("customer-brand");
    await store.saveBrand(partnerId, look("Acme"));
    const orgId = await organization("branded");
    await store.linkCustomer({ partnerId, organizationId: orgId, hostname: "a.example.test" });
    expect((await store.customerBrand(orgId))?.brand.appName).toBe("Acme");
    expect(await store.customerBrand(`nobody-${suffix}`)).toBeNull();
  });

  it("keeps the sender domain when the look is saved again", async () => {
    const store = createPrismaBrandingStore(prisma);
    const partnerId = await whiteLabel("sender");
    await store.saveBrand(partnerId, look("Acme"));
    await store.saveSender(partnerId, {
      senderDomain: "mail.acme.example.test",
      senderState: "pending",
      senderProviderId: "ed-1",
      senderRecords: [{ type: "MX", name: "send", value: "feedback", status: "pending" }],
      senderError: null,
      checkedAt: new Date(),
    });
    await store.saveBrand(partnerId, look("Acme 2"));
    const brand = await store.brand(partnerId);
    expect(brand).toMatchObject({
      appName: "Acme 2",
      senderDomain: "mail.acme.example.test",
      senderState: "pending",
    });
    expect(brand?.senderRecords).toHaveLength(1);
  });
});
