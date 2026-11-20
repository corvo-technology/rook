import { SCOPED_RULE_KIND } from "@corvo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listApprovalRules,
  listScopedApprovalRules,
  removeScopedApprovalRule,
  saveScopedApprovalRule,
} from "./approval-settings.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("kept always-allow rules", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `scoped-user-${suffix}`;
  const otherUserId = `scoped-other-${suffix}`;
  const organizationId = `scoped-org-${suffix}`;
  const spaceId = `scoped-space-${suffix}`;
  const botA = `scoped-bot-a-${suffix}`;
  const botB = `scoped-bot-b-${suffix}`;
  const scope = { userId, spaceId };
  const target = { tool: "gmail_send_email", connection: "kind:gmail" };
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "scoped approval rules test");
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: "x", email: `${id}@corvo.test`, emailVerified: false },
      });
    }
    await prisma.organization.create({
      data: { id: organizationId, name: "Scoped", slug: organizationId, createdAt: new Date() },
    });
    const createdAt = new Date();
    await prisma.member.create({
      data: { id: `${userId}-member`, organizationId, userId, role: "owner", createdAt },
    });
    await prisma.space.create({
      data: { id: spaceId, organizationId, name: "General", createdByUserId: userId },
    });
    await prisma.spaceMember.create({
      data: { id: `${spaceId}-member`, spaceId, organizationId, userId, createdAt },
    });
    for (const id of [botA, botB]) {
      await prisma.bot.create({ data: { id, spaceId, userId, name: id, color: "ink" } });
    }
  });

  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const save = (botId: string, tool = target) =>
    prisma.$transaction((tx) => saveScopedApprovalRule(tx, scope, botId, tool));

  it("keeps a rule per agent, connection and tool, and saving it again changes nothing", async () => {
    const first = await save(botA);
    const again = await save(botA);
    expect(again.id).toBe(first.id);
    await save(botB);
    await save(botA, { tool: "gmail_send_email", connection: "kind:outlook" });
    await save(botA, { tool: "gmail_create_draft", connection: "kind:gmail" });
    expect(await listScopedApprovalRules(prisma, scope, botA)).toHaveLength(3);
    expect(await listScopedApprovalRules(prisma, scope, botB)).toEqual([
      expect.objectContaining({ botId: botB, tool: "gmail_send_email", connection: "kind:gmail" }),
    ]);
    expect(await listScopedApprovalRules(prisma, scope)).toHaveLength(4);
  });

  it("is private to the member who kept it", async () => {
    expect(
      await listScopedApprovalRules(prisma, { userId: otherUserId, spaceId }, botA),
    ).toHaveLength(0);
  });

  it("stays out of the list of general rules, which the previous release also reads", async () => {
    const general = await listApprovalRules(prisma, scope, "space");
    expect(general.some((row) => row.matchKind === SCOPED_RULE_KIND)).toBe(false);
  });

  it("removes one rule, only for its owner, and the next call asks again", async () => {
    const [rule] = await listScopedApprovalRules(prisma, scope, botB);
    expect(await removeScopedApprovalRule(prisma, { userId: otherUserId, spaceId }, rule!.id)).toBe(
      false,
    );
    expect(await removeScopedApprovalRule(prisma, scope, rule!.id)).toBe(true);
    expect(await listScopedApprovalRules(prisma, scope, botB)).toEqual([]);
    expect(await listScopedApprovalRules(prisma, scope, botA)).toHaveLength(3);
  });

  it("goes away with the agent", async () => {
    await prisma.bot.delete({ where: { id: botA } });
    expect(await listScopedApprovalRules(prisma, scope)).toEqual([]);
  });
});
