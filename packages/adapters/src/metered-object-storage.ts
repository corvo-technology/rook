import type { ObjectStorage } from "@corvo/adapter-kit";
import { StorageQuotaError } from "@corvo/adapter-kit";
import type { PlanConfig } from "@corvo/contracts";
import { planConfigFromEnv, storageLevel } from "@corvo/contracts";
import { utcMonthKey } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import {
  claimStorageAlert,
  forgetStoredObjects,
  notifyStorageNearLimit,
  organizationEntitlements,
  organizationIdForObjectKey,
  reconcileStorageUsage,
  recordStoredObject,
  storageUsedBytes,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { objectStorageConfigFromEnv, S3ObjectStorage } from "./s3-object-storage.js";

type Db = Pick<
  PrismaClient,
  | "$transaction"
  | "billingAccount"
  | "computer"
  | "member"
  | "notification"
  | "organizationLimitOverride"
  | "space"
  | "storageObject"
  | "storageUsage"
>;

/**
 * Object storage that counts each organization's bytes under its plan. Every put records the
 * object's size and every delete takes it back; a put is refused, before any byte is sent, once
 * the organization's storage is full. Nothing is ever deleted to make room. Objects that belong
 * to no organization pass through unchanged.
 */
export class MeteredObjectStorage implements ObjectStorage {
  constructor(
    private readonly inner: ObjectStorage,
    private readonly deps: { prisma: Db; plans: PlanConfig; now?: () => Date },
  ) {}

  async put(key: string, body: AsyncIterable<Uint8Array>): Promise<void> {
    const { prisma, plans } = this.deps;
    const organizationId = await organizationIdForObjectKey(prisma, key);
    if (!organizationId) return this.inner.put(key, body);
    const limits = await organizationEntitlements(prisma, plans, organizationId);
    if (limits) {
      const used = await storageUsedBytes(prisma, organizationId);
      if (used >= limits.storageBytes) throw new StorageQuotaError(used, limits.storageBytes);
    }
    let bytes = 0;
    await this.inner.put(
      key,
      count(body, (length) => (bytes += length)),
    );
    try {
      const total = await recordStoredObject(prisma, { key, organizationId, bytes });
      if (limits) await this.alertWhenNear(organizationId, total, limits.storageBytes);
    } catch (error) {
      // The object is stored; the next reconcile corrects the count.
      getLogger().error("storage accounting after put", error);
    }
  }

  private async alertWhenNear(organizationId: string, usedBytes: number, limitBytes: number) {
    if (storageLevel(usedBytes, limitBytes) === "ok") return;
    await notifyOnce(this.deps.prisma, organizationId, usedBytes, limitBytes, this.deps.now?.());
  }

  get(key: string) {
    return this.inner.get(key);
  }

  list(prefix: string) {
    return this.inner.list(prefix);
  }

  async delete(keys: readonly string[]): Promise<void> {
    await this.inner.delete(keys);
    try {
      await forgetStoredObjects(this.deps.prisma, keys);
    } catch (error) {
      getLogger().error("storage accounting after delete", error);
    }
  }
}

/** The owner hears once per UTC month that storage passed 80%. */
async function notifyOnce(
  prisma: Db,
  organizationId: string,
  usedBytes: number,
  limitBytes: number,
  now = new Date(),
) {
  const period = utcMonthKey(now);
  if (!(await claimStorageAlert(prisma, organizationId, period))) return;
  await notifyStorageNearLimit(prisma, organizationId, { usedBytes, limitBytes, period });
}

async function* count(
  source: AsyncIterable<Uint8Array>,
  add: (length: number) => void,
): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    add(chunk.byteLength);
    yield chunk;
  }
}

/**
 * The bucket as this deployment uses it: counted per organization where it configures plans,
 * and plain otherwise (self-hosted storage is unlimited).
 */
export function createObjectStorage(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
): ObjectStorage | undefined {
  const config = objectStorageConfigFromEnv(env);
  if (!config) return undefined;
  const storage = new S3ObjectStorage(config);
  const plans = planConfigFromEnv(env);
  return plans ? new MeteredObjectStorage(storage, { prisma, plans }) : storage;
}

const RECONCILE_INTERVAL_MS = 60 * 60_000;
const COUNTED_PREFIXES = ["artifacts/", "homes/"];

/**
 * Hourly: sums what the bucket holds per organization and corrects the counters, then tells
 * the owner of any organization the correction put over 80%. Undefined without plans or storage.
 */
export function storageUsageReconciler(
  prisma: PrismaClient,
  env: NodeJS.ProcessEnv = process.env,
  storage = createObjectStorage(prisma, env),
): (() => Promise<void>) | undefined {
  const plans = planConfigFromEnv(env);
  if (!plans || !storage) return undefined;
  let last: number | undefined;
  return async () => {
    const now = Date.now();
    if (last !== undefined && now - last < RECONCILE_INTERVAL_MS) return;
    last = now;
    await reconcileStorage(prisma, storage, plans);
  };
}

export async function reconcileStorage(
  prisma: Db,
  storage: ObjectStorage,
  plans: PlanConfig,
  now = new Date(),
): Promise<string[]> {
  async function* objects() {
    for (const prefix of COUNTED_PREFIXES)
      for await (const object of storage.list(prefix))
        yield { key: object.key, size: object.size ?? 0, lastModified: object.lastModified };
  }
  const changed = await reconcileStorageUsage(prisma, objects(), now);
  for (const organizationId of changed) {
    const limits = await organizationEntitlements(prisma, plans, organizationId);
    if (!limits) continue;
    const used = await storageUsedBytes(prisma, organizationId);
    if (storageLevel(used, limits.storageBytes) !== "ok")
      await notifyOnce(prisma, organizationId, used, limits.storageBytes, now);
  }
  return changed;
}
