import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botTokensSince, claimBudgetAlert, runTokens } from "./bot-budget.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("bot budgets (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let provisioned = false;
  let userId: string;
  let spaceId: string;
  let botId: string;
  const address = `+1556${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;
  const since = new Date("2026-11-01T00:00:00.000Z");
  const during = new Date("2026-11-10T00:00:00.000Z");

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      try {
        await db.prisma.$disconnect();
      } finally {
        await db.pool.end();
      }
    };
    ({ userId, spaceId, botId } = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    ));
    provisioned = true;
  });

  afterAll(async () => {
    try {
      if (prisma && provisioned) {
        await system.usageRecord.deleteMany({ where: { spaceId } });
        await system.messagingIdentity.deleteMany({ where: { provider: "sendblue", address } });
        await system.organization.deleteMany({ where: { id: spaceId } });
        await system.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      await close?.();
    }
  });

  const row = (data: {
    totalTokens?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    createdAt?: Date;
    runId?: string;
    parentRunId?: string;
  }) =>
    system.usageRecord.create({
      data: {
        spaceId,
        userId,
        botId,
        provider: "test",
        model: "test",
        createdAt: during,
        ...data,
      },
    });

  it("sums a bot's month the way the usage page counts a row", async () => {
    await row({ totalTokens: 100 });
    await row({ inputTokens: 30, outputTokens: 20 });
    await row({});
    await row({ totalTokens: 9_999, createdAt: new Date("2026-10-31T23:59:59.000Z") });
    expect(await botTokensSince(system, botId, since)).toBe(150);
  });

  it("counts a run's subagent rows through parentRunId", async () => {
    await row({ totalTokens: 10, runId: "run-a", parentRunId: "run-a" });
    await row({ totalTokens: 5, runId: "sub-a", parentRunId: "run-a" });
    await row({ totalTokens: 7, runId: "run-b", parentRunId: "run-b" });
    expect(await runTokens(system, "run-a")).toBe(15);
  });

  it("lets one caller claim the month's alert", async () => {
    const claims = await Promise.all([
      claimBudgetAlert(system, botId, "2026-11"),
      claimBudgetAlert(system, botId, "2026-11"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await claimBudgetAlert(system, botId, "2026-12")).toBe(true);
  });
});
