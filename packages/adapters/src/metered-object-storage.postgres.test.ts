import { randomUUID } from "node:crypto";
import { StorageQuotaError } from "@corvo/adapter-kit";
import { planConfigFromEnv } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, provisionMessagingIdentity, runAsSystem } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MeteredObjectStorage, reconcileStorage } from "./metered-object-storage.js";
import { MemoryObjectStorage } from "./object-storage.test-support.js";

const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

/** A tiny plan: 1000 bytes of files, so 80% and 100% are a few small puts away. */
const PLANS = planConfigFromEnv({
  PLAN_PRICES: "{}",
  PLAN_LIMITS: JSON.stringify({ personal: { storageGb: 1000 / 1024 ** 3 } }),
})!;

async function* bytes(length: number) {
  yield new Uint8Array(length).fill(1);
}

describePostgres("metered object storage (PostgreSQL)", () => {
  const address = `metered-${randomUUID()}@corvo.test`;
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let owner: { userId: string; spaceId: string };
  let bucket: MemoryObjectStorage;
  let storage: MeteredObjectStorage;
  const key = () => `artifacts/${owner.spaceId}/${randomUUID()}`;
  const used = async () =>
    Number(
      (await system.storageUsage.findUnique({ where: { organizationId: owner.spaceId } }))?.bytes ??
        0,
    );
  const alerts = () =>
    system.notification.count({ where: { userId: owner.userId, code: "storage_near_limit" } });

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma, "metered storage fixture");
    owner = await runAsSystem("metered storage fixture", () =>
      provisionMessagingIdentity(
        db.prisma,
        { provider: "email", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    bucket = new MemoryObjectStorage();
    storage = new MeteredObjectStorage(bucket, { prisma: system, plans: PLANS });
  });

  afterAll(async () => {
    if (owner) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.organization.deleteMany({ where: { id: owner.spaceId } });
      await system.user.deleteMany({ where: { id: owner.userId } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("counts puts and deletes, tells the owner once at 80%, and refuses at 100% without deleting", async () => {
    const [a, b, c, d] = [key(), key(), key(), key()];
    await storage.put(a, bytes(300));
    await storage.put(b, bytes(400));
    expect(await used()).toBe(700);
    expect(await alerts()).toBe(0);

    await storage.put(c, bytes(150));
    expect(await used()).toBe(850);
    expect(await alerts()).toBe(1);
    // Further puts past 80% in the same period do not alert again.
    await storage.put(d, bytes(150));
    expect(await used()).toBe(1000);
    expect(await alerts()).toBe(1);

    // Full: the next upload is refused before any byte is stored, and everything stays.
    const refused = key();
    await expect(storage.put(refused, bytes(1))).rejects.toBeInstanceOf(StorageQuotaError);
    expect(bucket.objects.has(refused)).toBe(false);
    expect([a, b, c, d].every((existing) => bucket.objects.has(existing))).toBe(true);
    expect(await used()).toBe(1000);

    // Freeing space lets the same write through.
    await storage.delete([a]);
    expect(await used()).toBe(700);
    await storage.put(refused, bytes(1));
    expect(bucket.objects.has(refused)).toBe(true);
    expect(await used()).toBe(701);
  });

  it("passes objects that belong to no organization through uncounted", async () => {
    const before = await used();
    await storage.put("elsewhere/object", bytes(5000));
    expect(bucket.objects.has("elsewhere/object")).toBe(true);
    expect(await used()).toBe(before);
  });

  it("reconciles the counter from the bucket and alerts when that puts an owner over 80%", async () => {
    // Drift: objects arrived outside the counter, and the counter lost track.
    const outside = key();
    await bucket.put(outside, bytes(100));
    await system.storageUsage.update({
      where: { organizationId: owner.spaceId },
      data: { bytes: 0n, alertedPeriod: null },
    });
    await system.storageObject.deleteMany({ where: { organizationId: owner.spaceId } });
    await system.notification.deleteMany({ where: { userId: owner.userId } });

    const changed = await reconcileStorage(system, bucket, PLANS);
    expect(changed).toContain(owner.spaceId);
    const total = [...bucket.objects]
      .filter(([name]) => name.startsWith(`artifacts/${owner.spaceId}/`))
      .reduce((sum, [, object]) => sum + object.bytes.length, 0);
    expect(await used()).toBe(total);
    expect(total).toBeGreaterThan(800);
    expect(await alerts()).toBe(1);

    // Running it again changes nothing and does not alert again.
    expect(await reconcileStorage(system, bucket, PLANS)).not.toContain(owner.spaceId);
    expect(await alerts()).toBe(1);
  });
});
