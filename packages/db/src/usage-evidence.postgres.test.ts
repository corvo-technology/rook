import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordBillingEvidence } from "./billing-evidence.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { reconcileCreditPurchase } from "./model-credits.js";
import { asSystem } from "./row-security.js";
import { usageEvidenceCsv, usageEvidenceReport } from "./usage-evidence.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("usage evidence report", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `report-org-${suffix}`;
  const otherOrganizationId = `report-other-${suffix}`;
  const spaceId = `report-space-${suffix}`;
  const userId = `report-user-${suffix}`;
  const botId = `report-bot-${suffix}`;
  const computerId = `report-computer-${suffix}`;
  const customerId = `cus_report_${suffix}`;
  const march = { from: new Date("2026-03-01T00:00:00Z"), to: new Date("2026-04-01T00:00:00Z") };
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "usage evidence report test");
    await prisma.user.create({
      data: { id: userId, name: "x", email: `${userId}@corvo.test`, emailVerified: false },
    });
    for (const id of [organizationId, otherOrganizationId])
      await prisma.organization.create({
        data: { id, name: "Evidence", slug: id, createdAt: new Date() },
      });
    await prisma.space.create({
      data: { id: spaceId, organizationId, name: "General", isDefault: true },
    });
    await prisma.billingAccount.create({ data: { organizationId, customerId } });
    await prisma.computer.create({
      data: {
        id: computerId,
        spaceId,
        userId,
        scopeKey: computerId,
        homeKey: computerId,
        kind: "fake",
      },
    });
    await prisma.bot.create({
      data: { id: botId, spaceId, userId, name: "Ana", color: "x", computerId },
    });
    const thread = await prisma.thread.create({ data: { spaceId, userId } });

    const call = (id: string, at: string, cost: number, org = spaceId) =>
      prisma.usageRecord.create({
        data: {
          id,
          spaceId: org,
          userId,
          botId,
          provider: "p",
          model: "m",
          totalTokens: 10,
          costUsd: cost,
          providerRequestId: `req-${id}`,
          createdAt: new Date(at),
        },
      });
    await call(`${suffix}-in-1`, "2026-03-05T10:00:00Z", 0.01);
    await call(`${suffix}-in-2`, "2026-03-31T23:59:59Z", 0.02);
    await call(`${suffix}-before`, "2026-02-28T23:59:59Z", 0.03);
    await call(`${suffix}-after`, "2026-04-01T00:00:00Z", 0.04);
    // A later correction of a call replaces its cost in the report, not the call itself.
    await prisma.usageRecord.update({
      where: { id: `${suffix}-in-1` },
      data: { costUsd: 0.015 },
    });

    await prisma.computerRun.createMany({
      data: [
        {
          computerId,
          spaceId,
          userId,
          kind: "fake",
          providerRef: "box-1",
          startedAt: new Date("2026-03-10T10:00:00Z"),
          endedAt: new Date("2026-03-10T11:30:00Z"),
          endReason: "idle",
        },
        {
          computerId,
          spaceId,
          userId,
          kind: "fake",
          startedAt: new Date("2026-01-10T10:00:00Z"),
          endedAt: new Date("2026-01-10T11:00:00Z"),
          endReason: "idle",
        },
      ],
    });
    await prisma.computerResourceSample.createMany({
      data: [
        {
          computerId,
          spaceId,
          organizationId,
          userId,
          sampledAt: new Date("2026-03-10T10:05:00Z"),
          reason: "tick",
          cpuSeconds: 3,
          memoryBytes: 100n,
        },
        {
          computerId,
          spaceId,
          organizationId,
          userId,
          sampledAt: new Date("2026-03-10T11:30:00Z"),
          reason: "stop",
          cpuSeconds: 9,
          memoryBytes: 200n,
        },
        {
          computerId,
          spaceId,
          organizationId,
          userId,
          sampledAt: new Date("2026-02-10T10:05:00Z"),
          reason: "tick",
          cpuSeconds: 1,
        },
      ],
    });
    await prisma.event.createMany({
      data: [
        {
          spaceId,
          threadId: thread.id,
          botId,
          seq: 1,
          type: "computer.command",
          runId: "run-1",
          createdAt: new Date("2026-03-10T10:10:00Z"),
          payload: {
            executionId: "e1",
            kind: "shell",
            command: "=cmd|' /C calc'!A0",
            cwd: ".",
            status: "done",
            exitCode: 0,
            output: "secret output",
          },
        },
        {
          spaceId,
          threadId: thread.id,
          botId,
          seq: 2,
          type: "agent.tool.called",
          runId: "run-1",
          createdAt: new Date("2026-03-10T10:11:00Z"),
          payload: { name: "web_search", executionId: "e2" },
        },
        {
          spaceId,
          threadId: thread.id,
          botId,
          seq: 3,
          type: "computer.command",
          runId: "run-0",
          createdAt: new Date("2026-02-10T10:10:00Z"),
          payload: {
            executionId: "e0",
            kind: "shell",
            command: "old",
            cwd: ".",
            status: "done",
            exitCode: 0,
            output: "",
          },
        },
      ],
    });
    await prisma.storageSnapshot.createMany({
      data: [
        { organizationId, day: "2026-03-15", bytes: 100n },
        { organizationId, day: "2026-03-31", bytes: 300n },
        { organizationId, day: "2026-04-01", bytes: 999n },
      ],
    });
    await recordBillingEvidence(prisma, customerId, {
      eventId: `evt_${suffix}`,
      type: "checkout.session.completed",
      occurredAt: new Date("2026-03-02T12:00:00Z"),
      sessionId: `cs_${suffix}`,
      amountMinor: 4900,
      currency: "brl",
      termsAccepted: true,
      termsVersion: "v7",
    });
    await recordBillingEvidence(prisma, customerId, {
      eventId: `evt_old_${suffix}`,
      type: "invoice.paid",
      occurredAt: new Date("2026-02-02T12:00:00Z"),
      amountMinor: 4900,
      currency: "brl",
    });
    await reconcileCreditPurchase(prisma, organizationId, {
      id: `${organizationId}-invoice`,
      amountCents: 1000,
    });
    // Noise from another organization must not leak in.
    await reconcileCreditPurchase(prisma, otherOrganizationId, {
      id: `${otherOrganizationId}-invoice`,
      amountCents: 500,
    });
  });
  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const now = new Date();
  const around = {
    from: new Date(now.getTime() - 3_600_000),
    to: new Date(now.getTime() + 3_600_000),
  };

  it("includes exactly the rows in range, from this organization only", async () => {
    const report = await usageEvidenceReport(prisma, { organizationId, ...march });

    expect(report.modelCalls.map((c) => [c.callTime, c.costUsd, c.providerRequestId])).toEqual([
      ["2026-03-05T10:00:00.000Z", 0.015, `req-${suffix}-in-1`],
      ["2026-03-31T23:59:59.000Z", 0.02, `req-${suffix}-in-2`],
    ]);
    expect(report.modelCalls[0]).toMatchObject({ userId, botId, model: "m", totalTokens: 10 });
    expect(report.computerRuns).toEqual([
      expect.objectContaining({
        computerId,
        providerRef: "box-1",
        durationSeconds: 5400,
        open: false,
        endReason: "idle",
      }),
    ]);
    expect(report.resourceSamples.map((s) => [s.reason, s.cpuSeconds, s.memoryBytes])).toEqual([
      ["tick", 3, "100"],
      ["stop", 9, "200"],
    ]);
    expect(report.actions.map((a) => [a.kind, a.detail, a.computerId])).toEqual([
      ["command", "=cmd|' /C calc'!A0", computerId],
      ["tool", "web_search", computerId],
    ]);
    expect(JSON.stringify(report)).not.toContain("secret output");
    expect(report.termsAcceptances).toEqual([
      expect.objectContaining({ termsVersion: "v7", sessionId: `cs_${suffix}` }),
    ]);
    expect(report.billingEvents.map((e) => e.kind)).toEqual(["stripe.checkout.session.completed"]);
    expect(report.billingEvents[0]).toMatchObject({ amountMinor: 4900, currency: "brl" });
    expect(report.creditLedger).toEqual([]);
    // The reading of the period's last day, not the next day's.
    expect(report.storage).toMatchObject({ snapshotDay: "2026-03-31", snapshotBytes: "300" });
    expect(
      (
        await usageEvidenceReport(prisma, {
          organizationId,
          from: march.from,
          to: new Date("2026-03-20T00:00:00Z"),
        })
      ).storage,
    ).toMatchObject({ snapshotDay: "2026-03-15", snapshotBytes: "100" });

    const now = await usageEvidenceReport(prisma, { organizationId, ...around });
    expect(now.creditLedger.map((e) => [e.kind, e.amountMicros])).toEqual([
      ["purchase", "10000000"],
    ]);
  });

  it("writes every section as CSV with spreadsheet formulas defused", async () => {
    const report = await usageEvidenceReport(prisma, { organizationId, ...march });
    const csv = usageEvidenceCsv(report);
    expect(csv).toContain("# modelCalls");
    expect(csv).toContain("# computerRuns");
    expect(csv).toContain("# resourceSamples");
    expect(csv).toContain("# actions");
    expect(csv).toContain("'=cmd|");
    expect(csv).not.toMatch(/(^|,)=cmd/m);
  });

  it("still reports a deleted organization's ledger, calls, runs and samples", async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: userId } });

    const report = await usageEvidenceReport(prisma, { organizationId, ...march });
    expect(report.modelCalls).toHaveLength(2);
    expect(report.computerRuns).toHaveLength(1);
    expect(report.resourceSamples).toHaveLength(2);
    expect(report.termsAcceptances).toHaveLength(1);
    expect(report.storage.snapshotBytes).toBe("300");
    const ledger = await usageEvidenceReport(prisma, { organizationId, ...around });
    expect(ledger.creditLedger.map((e) => [e.kind, e.amountMicros])).toEqual([
      ["purchase", "10000000"],
      ["account_closed", "0"],
    ]);
    expect(report.modelCalls[0]?.userId).toBe(userId);
  });
});
