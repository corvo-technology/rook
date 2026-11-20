import type { PrismaClient } from "./client.js";

/**
 * Records every organization's stored bytes for today (UTC), once: a repeat the same day keeps the
 * first reading. Append-only evidence of what was stored when. One statement; run as the system.
 */
export async function snapshotStorageUsage(
  prisma: Pick<PrismaClient, "$executeRaw">,
  now = new Date(),
): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await prisma.$executeRaw`
    INSERT INTO "storage_snapshots" ("id", "organizationId", "day", "bytes", "takenAt")
    SELECT gen_random_uuid()::text, "organizationId", ${day}, "bytes", ${now}::timestamp(3)
    FROM "storage_usage"
    ON CONFLICT ("organizationId", "day") DO NOTHING`;
}
