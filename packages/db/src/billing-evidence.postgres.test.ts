import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordBillingEvidence } from "./billing-evidence.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("billing evidence journal", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `bill-evidence-org-${suffix}`;
  const customerId = `cus_${suffix}`;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "billing evidence test");
    await prisma.organization.create({
      data: { id: organizationId, name: "Evidence", slug: organizationId, createdAt: new Date() },
    });
    await prisma.billingAccount.create({ data: { organizationId, customerId } });
  });
  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const checkout = {
    eventId: `evt_${suffix}`,
    type: "checkout.session.completed",
    occurredAt: new Date("2026-03-02T12:00:00Z"),
    sessionId: `cs_${suffix}`,
    subscriptionId: "sub_1",
    amountMinor: 4900,
    currency: "brl",
    termsAccepted: true,
    termsVersion: "v7",
  };

  it("stores the acceptance and the event once, however often the webhook repeats", async () => {
    for (let delivery = 0; delivery < 3; delivery++)
      await recordBillingEvidence(prisma, customerId, checkout);

    const rows = await prisma.billingAuditEvent.findMany({ where: { organizationId } });
    expect(rows.map((row) => row.kind).sort()).toEqual([
      "stripe.checkout.session.completed",
      "terms_accepted",
    ]);
    const terms = rows.find((row) => row.kind === "terms_accepted")!;
    expect(terms.createdAt).toEqual(checkout.occurredAt);
    expect(terms.details).toMatchObject({
      sessionId: checkout.sessionId,
      termsVersion: "v7",
      acceptedAt: "2026-03-02T12:00:00.000Z",
    });
    const event = rows.find((row) => row.kind !== "terms_accepted")!;
    expect(event).toMatchObject({ currency: "brl" });
    expect(event.details).toMatchObject({ amountMinor: 4900, subscriptionId: "sub_1" });
  });

  it("stores no acceptance for a payment that carries none", async () => {
    await recordBillingEvidence(prisma, customerId, {
      eventId: `evt_inv_${suffix}`,
      type: "invoice.paid",
      occurredAt: new Date("2026-04-02T12:00:00Z"),
      invoiceId: "in_1",
      amountMinor: 4900,
      currency: "brl",
    });
    expect(
      await prisma.billingAuditEvent.count({ where: { organizationId, kind: "terms_accepted" } }),
    ).toBe(1);
  });
});
