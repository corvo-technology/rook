import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { provisionMessagingIdentity } from "./messaging.js";
import {
  botCreditSpendMicros,
  creditAccount,
  reconcileCreditPurchase,
  reserveModelCredits,
  utcDayStart,
} from "./model-credits.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describe("utcDayStart", () => {
  it("starts the day at midnight UTC whatever the time of day", () => {
    expect(utcDayStart(new Date("2026-11-06T23:59:59.999Z")).toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    expect(utcDayStart(new Date("2026-11-06T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
  });
});

describePostgres("what a bot has spent from hosted credits (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let userId: string;
  let spaceId: string;
  let botId: string;
  let threadId: string;
  let otherBotId: string;
  const address = `+1555${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    ({ userId, spaceId, botId, threadId } = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    ));
    const other = await system.bot.create({
      data: { spaceId, userId, name: "Other", color: "#000000" },
    });
    otherBotId = other.id;
    await creditAccount(prisma, spaceId);
    await system.modelCreditAccount.update({
      where: { organizationId: spaceId },
      data: { mode: "credits" },
    });
    await reconcileCreditPurchase(prisma, spaceId, { id: `${spaceId}-fund`, amountCents: 5000 });
  });

  afterAll(async () => {
    try {
      await system.messagingIdentity.deleteMany({ where: { provider: "sendblue", address } });
      await system.organization.deleteMany({ where: { id: spaceId } });
      await system.user.deleteMany({ where: { id: userId } });
    } finally {
      await close?.();
    }
  });

  async function runFor(forBotId: string) {
    const task = await system.task.create({
      data: { spaceId, botId: forBotId, threadId, userId, prompt: "work", status: "running" },
    });
    return system.run.create({
      data: {
        spaceId,
        botId: forBotId,
        threadId,
        taskId: task.id,
        userId,
        status: "running",
        trigger: "user",
      },
    });
  }

  it("counts only this bot's calls today, whether settled or still held", async () => {
    const run = await runFor(botId);
    const otherRun = await runFor(otherBotId);
    // The executor reads the spend inside the run's Space, where row-level security shows its runs.
    const spent = () =>
      runAsTenant({ spaceId, userId }, () =>
        botCreditSpendMicros(prisma, botId, utcDayStart(new Date())),
      );
    const before = await spent();
    await reserveModelCredits(prisma, spaceId, 0.5, {
      callId: randomUUID(),
      spaceId,
      runId: run.id,
    });
    await reserveModelCredits(prisma, spaceId, 0.25, {
      callId: randomUUID(),
      spaceId,
      runId: run.id,
    });
    await reserveModelCredits(prisma, spaceId, 3, {
      callId: randomUUID(),
      spaceId,
      runId: otherRun.id,
    });
    const after = await spent();
    expect(after - before).toBe(750_000n);
  });

  it("leaves out spend before the day began", async () => {
    const run = await runFor(botId);
    const callId = randomUUID();
    await reserveModelCredits(prisma, spaceId, 1, { callId, spaceId, runId: run.id });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(await botCreditSpendMicros(prisma, botId, utcDayStart(tomorrow))).toBe(0n);
  });
});
