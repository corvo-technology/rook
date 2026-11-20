import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { reconcileCreditPurchase } from "./model-credits.js";
import { asSystem } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("usage evidence retention", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `evidence-org-${suffix}`;
  const spaceId = `evidence-space-${suffix}`;
  const userId = `evidence-user-${suffix}`;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "usage evidence test");
    await prisma.user.create({
      data: { id: userId, name: "x", email: `${userId}@corvo.test`, emailVerified: false },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Evidence", slug: organizationId, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id: spaceId, organizationId, name: "General", isDefault: true },
    });
  });
  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("keeps the ledger, model calls and computer runs when the organization and user are deleted", async () => {
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-invoice`,
      amountCents: 1000,
    });
    await prisma.usageRecord.create({
      data: {
        spaceId,
        userId,
        botId: "bot-gone",
        provider: "p",
        model: "m",
        totalTokens: 12,
        costUsd: 0.01,
        providerRequestId: "req-1",
        callId: `call-${suffix}`,
      },
    });
    const startedAt = new Date("2026-03-01T10:00:00Z");
    await prisma.computerRun.create({
      data: { computerId: `computer-${suffix}`, spaceId, userId, kind: "docker", startedAt },
    });

    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });

    expect(await prisma.modelCreditEntry.count({ where: { organizationId } })).toBe(0);
    const journal = await prisma.billingAuditEvent.findMany({ where: { organizationId } });
    expect(journal.find((e) => e.kind === "purchase")?.amountMicros).toBe(10_000_000n);
    expect(journal.find((e) => e.kind === "usage")?.providerRequestId).toBe("req-1");
    const run = await prisma.computerRun.findFirstOrThrow({
      where: { computerId: `computer-${suffix}` },
    });
    expect(run).toMatchObject({ spaceId, userId, organizationId });
  });
});
