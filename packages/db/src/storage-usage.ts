import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

type Db = Pick<
  PrismaClient,
  "storageUsage" | "storageObject" | "space" | "computer" | "$transaction"
>;

const ARTIFACT_KEY = /^artifacts\/([^/]+)\/[^/]+$/;
const HOME_KEY = /^homes\/([^/]+)\/[^/]+$/;
/** An object recorded this recently is never dropped by a reconcile that may not have listed it. */
const RECONCILE_GRACE_MS = 10 * 60_000;
const BATCH = 500;

/** The organization an object key belongs to: drive files and attachments, or a computer home. */
export async function organizationIdForObjectKey(
  prisma: Pick<PrismaClient, "space" | "computer">,
  key: string,
): Promise<string | null> {
  return runAsSystem("storage accounting resolves an object's organization", async () => {
    const artifact = ARTIFACT_KEY.exec(key);
    if (artifact) {
      const space = await prisma.space.findUnique({
        where: { id: artifact[1]! },
        select: { organizationId: true },
      });
      return space?.organizationId ?? null;
    }
    const home = HOME_KEY.exec(key);
    if (home) {
      const computer = await prisma.computer.findUnique({
        where: { homeStorageId: home[1]! },
        select: { space: { select: { organizationId: true } } },
      });
      return computer?.space.organizationId ?? null;
    }
    return null;
  });
}

export async function storageUsedBytes(
  prisma: Pick<PrismaClient, "storageUsage">,
  organizationId: string,
): Promise<number> {
  const row = await prisma.storageUsage.findUnique({
    where: { organizationId },
    select: { bytes: true },
  });
  return Number(row?.bytes ?? 0n);
}

/** Records an object's size, replacing what an earlier put of the same key recorded. */
export async function recordStoredObject(
  prisma: Pick<PrismaClient, "$transaction">,
  input: { key: string; organizationId: string; bytes: number },
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.storageObject.findUnique({
      where: { key: input.key },
      select: { bytes: true, organizationId: true },
    });
    await tx.storageObject.upsert({
      where: { key: input.key },
      create: { key: input.key, organizationId: input.organizationId, bytes: BigInt(input.bytes) },
      update: {
        organizationId: input.organizationId,
        bytes: BigInt(input.bytes),
        recordedAt: new Date(),
      },
    });
    if (previous && previous.organizationId !== input.organizationId)
      await tx.storageUsage.updateMany({
        where: { organizationId: previous.organizationId },
        data: { bytes: { decrement: previous.bytes } },
      });
    const delta =
      BigInt(input.bytes) -
      (previous?.organizationId === input.organizationId ? previous.bytes : 0n);
    const usage = await tx.storageUsage.upsert({
      where: { organizationId: input.organizationId },
      create: { organizationId: input.organizationId, bytes: delta > 0n ? delta : 0n },
      update: { bytes: { increment: delta } },
      select: { bytes: true },
    });
    return Number(usage.bytes);
  });
}

/** Subtracts what each deleted object added; keys never recorded change nothing. */
export async function forgetStoredObjects(
  prisma: Pick<PrismaClient, "$transaction">,
  keys: readonly string[],
): Promise<void> {
  for (let start = 0; start < keys.length; start += BATCH) {
    const batch = keys.slice(start, start + BATCH);
    await prisma.$transaction(async (tx) => {
      const rows = await tx.storageObject.findMany({
        where: { key: { in: batch } },
        select: { key: true, organizationId: true, bytes: true },
      });
      if (!rows.length) return;
      await tx.storageObject.deleteMany({ where: { key: { in: rows.map((row) => row.key) } } });
      const freed = new Map<string, bigint>();
      for (const row of rows)
        freed.set(row.organizationId, (freed.get(row.organizationId) ?? 0n) + row.bytes);
      for (const [organizationId, bytes] of freed) {
        await tx.storageUsage.updateMany({
          where: { organizationId },
          data: { bytes: { decrement: bytes } },
        });
        // Never below zero, whatever drifted.
        await tx.storageUsage.updateMany({
          where: { organizationId, bytes: { lt: 0n } },
          data: { bytes: 0n },
        });
      }
    });
  }
}

/**
 * Claims the once-per-period alert for an organization: true for the first caller in a period.
 */
export async function claimStorageAlert(
  prisma: Pick<PrismaClient, "storageUsage">,
  organizationId: string,
  period: string,
): Promise<boolean> {
  const claimed = await prisma.storageUsage.updateMany({
    where: {
      organizationId,
      OR: [{ alertedPeriod: null }, { alertedPeriod: { not: period } }],
    },
    data: { alertedPeriod: period },
  });
  return claimed.count === 1;
}

/** Lets the alert fire again in the same period once usage has dropped back under the line. */
export async function releaseStorageAlert(
  prisma: Pick<PrismaClient, "storageUsage">,
  organizationId: string,
): Promise<void> {
  await prisma.storageUsage.updateMany({
    where: { organizationId, alertedPeriod: { not: null } },
    data: { alertedPeriod: null },
  });
}

/**
 * Tells an organization's owners, once, that storage is near its limit: an inbox alert in each
 * owner's first space, worded by the client from its code.
 */
export async function notifyStorageNearLimit(
  prisma: Pick<PrismaClient, "member" | "space" | "notification">,
  organizationId: string,
  input: { usedBytes: number; limitBytes: number; period: string },
): Promise<number> {
  return runAsSystem("storage alert reaches the organization's owners", async () => {
    const owners = await prisma.member.findMany({
      where: { organizationId, role: { contains: "owner" } },
      select: { userId: true },
    });
    const space = await prisma.space.findFirst({
      where: { organizationId, deletingAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    if (!space) return 0;
    const percent = Math.min(100, Math.floor((input.usedBytes / input.limitBytes) * 100));
    for (const owner of owners)
      await prisma.notification.upsert({
        where: {
          userId_dedupeKey: { userId: owner.userId, dedupeKey: `storage:${organizationId}` },
        },
        create: {
          spaceId: space.id,
          userId: owner.userId,
          kind: "alert",
          dedupeKey: `storage:${organizationId}`,
          detail: `Storage is ${percent}% full.`,
          code: "storage_near_limit",
          params: { percent: String(percent) },
        },
        update: {
          detail: `Storage is ${percent}% full.`,
          code: "storage_near_limit",
          params: { percent: String(percent) },
          readAt: null,
          createdAt: new Date(),
        },
      });
    return owners.length;
  });
}

export interface ListedObject {
  key: string;
  size: number;
  lastModified: Date;
}

/**
 * Corrects the ledger and counters from what the bucket holds. Objects it lists are recorded
 * with their real size; recorded objects it did not list are forgotten, except ones recorded
 * in the last few minutes, which a listing that began earlier may have missed. Returns the
 * organizations whose count changed.
 */
export async function reconcileStorageUsage(
  prisma: Db,
  listing: AsyncIterable<ListedObject>,
  now = new Date(),
): Promise<string[]> {
  const seen = new Set<string>();
  const organizations = new Map<string, string | null>();
  const changed = new Set<string>();
  const resolve = async (key: string) => {
    const bucket = key.split("/").slice(0, 2).join("/");
    if (!organizations.has(bucket))
      organizations.set(bucket, await organizationIdForObjectKey(prisma, key));
    return organizations.get(bucket) ?? null;
  };
  for await (const object of listing) {
    seen.add(object.key);
    const organizationId = await resolve(object.key);
    if (!organizationId) continue;
    const known = await prisma.storageObject.findUnique({
      where: { key: object.key },
      select: { bytes: true, organizationId: true },
    });
    if (known && known.bytes === BigInt(object.size) && known.organizationId === organizationId)
      continue;
    await recordStoredObject(prisma, { key: object.key, organizationId, bytes: object.size });
    changed.add(organizationId);
  }
  const cutoff = new Date(now.getTime() - RECONCILE_GRACE_MS);
  const recorded = await prisma.storageObject.findMany({
    where: { recordedAt: { lt: cutoff } },
    select: { key: true, organizationId: true },
  });
  const gone = recorded.filter((row) => !seen.has(row.key));
  for (const row of gone) changed.add(row.organizationId);
  await forgetStoredObjects(
    prisma,
    gone.map((row) => row.key),
  );
  // The ledger is the truth the counters are rebuilt from, so drift cannot outlive a reconcile.
  const totals = await prisma.storageObject.groupBy({
    by: ["organizationId"],
    _sum: { bytes: true },
  });
  for (const total of totals) {
    const bytes = total._sum.bytes ?? 0n;
    const usage = await prisma.storageUsage.findUnique({
      where: { organizationId: total.organizationId },
      select: { bytes: true },
    });
    if (usage?.bytes !== bytes) changed.add(total.organizationId);
    await prisma.storageUsage.upsert({
      where: { organizationId: total.organizationId },
      create: { organizationId: total.organizationId, bytes, reconciledAt: now },
      update: { bytes, reconciledAt: now },
    });
  }
  // An organization whose last object went away has no ledger rows left.
  await prisma.storageUsage.updateMany({
    where: {
      organizationId: { notIn: totals.map((total) => total.organizationId) },
      bytes: { not: 0n },
    },
    data: { bytes: 0n, reconciledAt: now },
  });
  return [...changed];
}
