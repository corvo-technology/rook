import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { asSystem } from "./row-security.js";
import { snapshotStorageUsage } from "./storage-snapshot.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("daily storage snapshot", () => {
  const organizationId = `snapshot-org-${process.pid}-${Date.now()}`;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "storage snapshot test");
    await prisma.organization.create({
      data: { id: organizationId, name: "Snap", slug: organizationId, createdAt: new Date() },
    });
    await prisma.storageUsage.create({ data: { organizationId, bytes: 500n } });
  });
  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  const rows = () =>
    prisma.storageSnapshot.findMany({ where: { organizationId }, orderBy: { day: "asc" } });

  it("keeps one row per organization per day, however often it runs", async () => {
    await snapshotStorageUsage(prisma, new Date("2026-03-05T01:00:00Z"));
    await prisma.storageUsage.update({ where: { organizationId }, data: { bytes: 900n } });
    await snapshotStorageUsage(prisma, new Date("2026-03-05T23:00:00Z"));
    await snapshotStorageUsage(prisma, new Date("2026-03-06T01:00:00Z"));
    expect((await rows()).map((r) => [r.day, r.bytes])).toEqual([
      ["2026-03-05", 500n],
      ["2026-03-06", 900n],
    ]);
  });

  it("survives the organization and refuses edits", async () => {
    await prisma.organization.delete({ where: { id: organizationId } });
    expect(await rows()).toHaveLength(2);
    await expect(
      prisma.storageSnapshot.updateMany({ where: { organizationId }, data: { bytes: 1n } }),
    ).rejects.toThrow();
  });
});
