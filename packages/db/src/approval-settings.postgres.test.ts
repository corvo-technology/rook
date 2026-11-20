import { approvalModeFromPreference } from "@corvo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findAutoReviewPreference, saveAutoReviewPreference } from "./approval-settings.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("approval level storage", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `level-user-${suffix}`;
  const organizationId = `level-org-${suffix}`;
  const spaceId = `level-space-${suffix}`;
  const scope = { userId, spaceId };
  const defaults = { enabled: false, skipApprovals: false, alwaysAsk: false };
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "approval level test");
    await prisma.user.create({
      data: { id: userId, name: "x", email: `${userId}@corvo.test`, emailVerified: false },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Levels", slug: organizationId, createdAt: new Date() },
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
  });

  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const save = (update: Partial<typeof defaults>) =>
    prisma.$transaction((tx) => saveAutoReviewPreference(tx, scope, update, defaults));

  it("reads a row the previous release saved as Only what's risky", async () => {
    // The previous release writes only these two columns, so the new one keeps its default.
    await prisma.userActionAutoReviewPreference.create({
      data: { userId, enabled: false, skipApprovals: false },
    });
    const stored = await findAutoReviewPreference(prisma, scope);
    expect(stored).toEqual({ enabled: false, skipApprovals: false, alwaysAsk: false });
    expect(approvalModeFromPreference(stored!)).toBe("risky");
  });

  it("keeps Always ask, and leaves the two columns the previous release reads at ask", async () => {
    await save({ enabled: false, skipApprovals: false, alwaysAsk: true });
    const stored = await findAutoReviewPreference(prisma, scope);
    expect(approvalModeFromPreference(stored!)).toBe("always");
    expect(stored).toMatchObject({ enabled: false, skipApprovals: false });
  });

  it("moves between every level", async () => {
    for (const [update, mode] of [
      [{ enabled: true, skipApprovals: false, alwaysAsk: false }, "auto"],
      [{ enabled: false, skipApprovals: true, alwaysAsk: false }, "never"],
      [{ enabled: false, skipApprovals: false, alwaysAsk: false }, "risky"],
    ] as const) {
      await save(update);
      expect(approvalModeFromPreference((await findAutoReviewPreference(prisma, scope))!)).toBe(
        mode,
      );
    }
  });
});
