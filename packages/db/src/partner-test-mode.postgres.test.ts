import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { recordCommerceEvent } from "./commerce-ledger.js";
import { holdCredits, reserveModelCredits } from "./model-credits.js";
import { platformPartnerOverview } from "./partner-overview.js";
import {
  findPartnerTenant,
  PartnerTenantModeMismatch,
  partnerSpaceState,
  provisionPartnerTenant,
  setPartnerTenantState,
} from "./partner-tenants.js";
import {
  isPartnerTestOrganization,
  listPartnerTestTenants,
  PartnerTestCapReached,
  partnerTestUsageToday,
  removePartnerTestTenants,
  setPartnerTestDailyCap,
  takePartnerTestCall,
} from "./partner-test-mode.js";
import { claimPartnerAllowanceNotices } from "./partner-webhook.js";
import {
  authenticatePartner,
  authenticatePartnerKey,
  createPartner,
  rotatePartnerTestKey,
  setPartnerTestWebhookUrl,
} from "./partners.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("partner test mode (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  async function newPartner(label: string) {
    const { partner, key } = await createPartner(db, {
      slug: `test-${label}-${suffix}`,
      name: label,
    });
    partnerIds.push(partner.id);
    const test = await rotatePartnerTestKey(db, partner.slug);
    return { partner: test.partner, liveKey: key, testKey: test.key };
  }

  async function newTenant(partner: { id: string }, id: string, testMode: boolean) {
    const tenant = await provisionPartnerTenant(
      db,
      { id: partner.id, testMode },
      { externalTenantId: id, name: id },
    );
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    return tenant;
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

  it("makes a test key that is told from the live key and never opens the other's door", async () => {
    const { partner, liveKey, testKey } = await newPartner("keys");
    expect(testKey.startsWith("cpk_test_")).toBe(true);
    expect(partner.testKeyPrefix?.startsWith("cpk_test_")).toBe(true);
    await expect(authenticatePartnerKey(db, testKey)).resolves.toMatchObject({
      id: partner.id,
      testMode: true,
    });
    await expect(authenticatePartnerKey(db, liveKey)).resolves.toMatchObject({
      id: partner.id,
      testMode: false,
    });
    // The pre-test entry point only ever accepts a live key.
    await expect(authenticatePartner(db, testKey)).resolves.toBeNull();
    // Replacing the test key leaves the live key alone and ends the old test key.
    const next = await rotatePartnerTestKey(db, partner.slug);
    await expect(authenticatePartnerKey(db, testKey)).resolves.toBeNull();
    await expect(authenticatePartnerKey(db, next.key)).resolves.toMatchObject({ testMode: true });
    await expect(authenticatePartnerKey(db, liveKey)).resolves.toMatchObject({ testMode: false });
  });

  it("keeps test and live customers apart in both directions", async () => {
    const { partner } = await newPartner("isolation");
    const live = await newTenant(partner, "shop", false);
    const test = await newTenant(partner, "try-it", true);
    expect(live.organizationId).not.toBe(test.organizationId);

    await expect(findPartnerTenant(db, partner.id, "shop", false)).resolves.not.toBeNull();
    await expect(findPartnerTenant(db, partner.id, "shop", true)).resolves.toBeNull();
    await expect(findPartnerTenant(db, partner.id, "try-it", true)).resolves.toMatchObject({
      testMode: true,
    });
    await expect(findPartnerTenant(db, partner.id, "try-it", false)).resolves.toBeNull();

    // A test key cannot suspend a live customer, nor a live key a test one.
    await expect(setPartnerTenantState(db, partner.id, "shop", "suspended", true)).resolves.toBe(
      false,
    );
    await expect(setPartnerTenantState(db, partner.id, "try-it", "suspended", false)).resolves.toBe(
      false,
    );
    await expect(findPartnerTenant(db, partner.id, "shop", false)).resolves.toMatchObject({
      state: "enabled",
    });
    await expect(setPartnerTenantState(db, partner.id, "try-it", "suspended", true)).resolves.toBe(
      true,
    );

    // An id that belongs to the other mode is refused instead of reaching across.
    await expect(
      provisionPartnerTenant(
        db,
        { id: partner.id, testMode: true },
        { externalTenantId: "shop", name: "x" },
      ),
    ).rejects.toBeInstanceOf(PartnerTenantModeMismatch);
    await expect(
      provisionPartnerTenant(db, { id: partner.id }, { externalTenantId: "try-it", name: "x" }),
    ).rejects.toBeInstanceOf(PartnerTenantModeMismatch);
  });

  it("never charges a test customer, whatever it uses, and counts the call instead", async () => {
    const { partner } = await newPartner("nocharge");
    const test = await newTenant(partner, "t1", true);
    const live = await newTenant(partner, "l1", false);
    await expect(isPartnerTestOrganization(db, test.organizationId)).resolves.toBe(true);
    await expect(isPartnerTestOrganization(db, live.organizationId)).resolves.toBe(false);

    const reservation = await reserveModelCredits(db, test.organizationId, 0.5, {
      callId: `call-${suffix}-1`,
    });
    expect(reservation.startsWith("test:")).toBe(true);
    await expect(holdCredits(db, test.organizationId, "voice-1", 5_000_000n)).resolves.toBe(
      "exists",
    );
    expect(
      await db.modelCreditEntry.count({ where: { organizationId: test.organizationId } }),
    ).toBe(0);
    const account = await db.modelCreditAccount.findUniqueOrThrow({
      where: { organizationId: test.organizationId },
    });
    expect(account.balanceMicros).toBe(0n);
    await expect(partnerTestUsageToday(db, partner.id)).resolves.toMatchObject({ calls: 1 });

    // A live customer without credit is still refused: only test mode is free.
    await expect(
      reserveModelCredits(db, live.organizationId, 0.5, { callId: `call-${suffix}-live` }),
    ).rejects.toThrow(/Not enough model credits/);
    // A commerce partner's test customer runs with no plan.
    await expect(partnerSpaceState(db, test.spaceId)).resolves.toBe("enabled");
  });

  it("stops the day's calls at the cap, per partner, and starts again the next day", async () => {
    const { partner } = await newPartner("cap");
    const other = await newPartner("cap-other");
    const test = await newTenant(partner, "capped", true);
    const otherTest = await newTenant(other.partner, "uncapped", true);
    await setPartnerTestDailyCap(db, partner.id, 2);
    const today = new Date("2026-12-20T10:00:00Z");

    await expect(takePartnerTestCall(db, test.organizationId, today)).resolves.toBe(true);
    await expect(takePartnerTestCall(db, test.organizationId, today)).resolves.toBe(true);
    await expect(takePartnerTestCall(db, test.organizationId, today)).rejects.toBeInstanceOf(
      PartnerTestCapReached,
    );
    // A refused call is not counted, so the count stays at the cap.
    await expect(partnerTestUsageToday(db, partner.id, today)).resolves.toEqual({
      calls: 2,
      cap: 2,
    });
    // Another partner's cap is its own.
    await expect(takePartnerTestCall(db, otherTest.organizationId, today)).resolves.toBe(true);
    // The next UTC day starts again.
    await expect(
      takePartnerTestCall(db, test.organizationId, new Date("2026-12-21T00:00:01Z")),
    ).resolves.toBe(true);
    // Two calls at once cannot both take the last place.
    await setPartnerTestDailyCap(db, partner.id, 1);
    const day = new Date("2026-12-22T10:00:00Z");
    const settled = await Promise.allSettled([
      takePartnerTestCall(db, test.organizationId, day),
      takePartnerTestCall(db, test.organizationId, day),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("is left out of every count: customers, usage and notices", async () => {
    const { partner } = await newPartner("revenue");
    await newTenant(partner, "real", false);
    await newTenant(partner, "fake", true);
    await db.partner.update({
      where: { id: partner.id },
      data: { webhookUrl: "https://hooks.example.test/live" },
    });
    const rows = await platformPartnerOverview(db, undefined);
    const row = rows.find((candidate) => candidate.id === partner.id);
    expect(row).toMatchObject({ activeCustomers: 1, testCustomers: 1, chargedCredits: 0 });
    const made = await claimPartnerAllowanceNotices(db);
    const events = await db.partnerWebhookEvent.count({ where: { partnerId: partner.id } });
    expect(events).toBe(0);
    expect(made).not.toContain(partner.id);
  });

  it("labels what a test customer owes the partner and sends it to the test address only", async () => {
    const { partner } = await newPartner("hooks");
    await newTenant(partner, "live-c", false);
    await newTenant(partner, "test-c", true);
    const event = (externalTenantId: string) => ({
      externalTenantId,
      kind: "subscription.lapsed",
      key: "2026-12:lapsed",
      payload: { plan: "team" },
    });
    const live = { id: partner.id, webhookUrl: "https://hooks.example.test/live" };

    // Without a test address a test customer's notice is not recorded anywhere.
    await expect(recordCommerceEvent(db, live, event("test-c"))).resolves.toBeNull();
    await setPartnerTestWebhookUrl(db, partner.slug, "https://hooks.example.test/test");
    const id = await recordCommerceEvent(db, live, event("test-c"));
    expect(id).not.toBeNull();
    await expect(
      db.partnerWebhookEvent.findUniqueOrThrow({ where: { id: id as string } }),
    ).resolves.toMatchObject({ payload: { plan: "team", test: true } });
    // Test customers do not reach the partner's people.
    await expect(
      db.partnerAlert.count({ where: { partnerId: partner.id, externalTenantId: "test-c" } }),
    ).resolves.toBe(0);

    // A live customer's notice is unchanged and unlabelled.
    const liveId = await recordCommerceEvent(db, live, event("live-c"));
    const liveRow = await db.partnerWebhookEvent.findUniqueOrThrow({
      where: { id: liveId as string },
    });
    expect(liveRow.payload).toEqual({ plan: "team" });
  });

  it("wipes the test customers and nothing else", async () => {
    const { partner } = await newPartner("wipe");
    const live = await newTenant(partner, "keep", false);
    const test = await newTenant(partner, "drop", true);
    const listed = await listPartnerTestTenants(db, partner.id);
    expect(listed.map((tenant) => tenant.organizationId)).toEqual([test.organizationId]);

    // Even if a live customer is named, the wipe never touches it.
    const removed = await removePartnerTestTenants(db, partner.id, [
      { organizationId: test.organizationId, ownerUserId: test.ownerUserId },
      { organizationId: live.organizationId, ownerUserId: live.ownerUserId },
    ]);
    expect(removed).toBe(1);
    await expect(
      db.partnerTenant.findFirst({ where: { organizationId: test.organizationId } }),
    ).resolves.toBeNull();
    await expect(
      db.organization.findUnique({ where: { id: test.organizationId } }),
    ).resolves.toBeNull();
    await expect(db.user.findUnique({ where: { id: test.ownerUserId } })).resolves.toBeNull();
    await expect(
      db.partnerTenant.findFirst({ where: { organizationId: live.organizationId } }),
    ).resolves.not.toBeNull();
    await expect(db.user.findUnique({ where: { id: live.ownerUserId } })).resolves.not.toBeNull();
  });
});
