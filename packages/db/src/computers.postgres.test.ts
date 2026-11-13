import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { ComputerLimitError, restoreBotUnderComputerQuota } from "./computers.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("per-space computer cap (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  const signup = { signupsEnabled: undefined, signupAllowlist: undefined };
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };
  const members: Array<{ userId: string; spaceId: string }> = [];
  const userIds: string[] = [];
  const saved = process.env.SANDBOX_MAX_COMPUTERS_PER_SPACE;

  const actor = (member: { userId: string; spaceId: string }) => ({
    userId: member.userId,
    spaceId: owner.spaceId,
    email: "space-cap@example.com",
    isDeploymentOwner: false,
  });
  const botInput = (name: string) => ({
    name,
    title: "",
    description: "",
    instructions: "",
    notifyOnFinish: true,
  });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address: `+1557${stamp}` },
        signup,
      ),
    );
    members.push(owner);
    // More people in the owner's space; each gets a computer of their own.
    const system = asSystem(prisma);
    for (let index = 0; index < 2; index += 1) {
      const id = `space-cap-${stamp}-${index}`;
      await system.user.create({
        data: { id, name: id, email: `${id}@corvo.test`, emailVerified: false },
      });
      await system.member.create({
        data: {
          id: randomUUID(),
          organizationId: owner.spaceId,
          userId: id,
          role: "member",
          createdAt: new Date(),
        },
      });
      userIds.push(id);
      members.push({ userId: id, spaceId: owner.spaceId });
    }
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env.SANDBOX_MAX_COMPUTERS_PER_SPACE;
    else process.env.SANDBOX_MAX_COMPUTERS_PER_SPACE = saved;
    if (prisma) {
      const system = asSystem(prisma, "test fixture cleanup");
      await system.messagingIdentity.deleteMany({ where: { address: `+1557${stamp}` } });
      await system.organization.deleteMany({ where: { id: owner?.spaceId } });
      await system.user.deleteMany({ where: { id: { in: [owner?.userId, ...userIds] } } });
    }
    await close?.();
  });

  it("lets only the allowed number of members' computers back live bots when archived bots are restored at once", async () => {
    const repos = createRepos(prisma);
    const system = asSystem(prisma);
    // Everyone has a bot, and so a computer; archived, they count for nothing.
    const bots: Array<{ member: (typeof members)[number]; botId: string; computerId: string }> = [];
    for (const [index, member] of members.entries()) {
      const bot = await runAsTenant({ userId: member.userId, spaceId: owner.spaceId }, () =>
        repos.createBot(actor(member), botInput(`Capped ${index}`)),
      );
      const row = await system.bot.update({
        where: { id: bot.id },
        data: { archivedAt: new Date() },
        select: { computerId: true },
      });
      bots.push({ member, botId: bot.id, computerId: row.computerId! });
    }
    process.env.SANDBOX_MAX_COMPUTERS_PER_SPACE = "1";

    const results = await Promise.allSettled(
      bots.map(({ member, botId, computerId }) =>
        runAsTenant({ userId: member.userId, spaceId: owner.spaceId }, () =>
          restoreBotUnderComputerQuota(prisma, {
            userId: member.userId,
            spaceId: owner.spaceId,
            botId,
            computerId,
          }),
        ),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.filter((result) => result.status === "rejected");
    expect(refused).toHaveLength(2);
    for (const result of refused) {
      expect(result.status === "rejected" && result.reason).toBeInstanceOf(ComputerLimitError);
    }
    const inUse = await system.computer.count({
      where: { spaceId: owner.spaceId, bots: { some: { archivedAt: null } } },
    });
    expect(inUse).toBe(1);
  });
});
