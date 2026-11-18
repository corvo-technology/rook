import { createHash } from "node:crypto";
import type { PrismaClient } from "./client.js";

const KEEP_MS = 30 * 24 * 60 * 60_000;
/** A call still pending this long is taken as lost; every step it runs is idempotent, so it reruns. */
const STALE_PENDING_MS = 30_000;

/** The same JSON with its keys in a fixed order, so the same body always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const requestHash = (route: string, body: unknown) =>
  createHash("sha256")
    .update(`${route}\n${canonical(body)}`)
    .digest("hex");

export type IdempotentOutcome =
  | { kind: "ran"; status: number; body: unknown }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" }
  | { kind: "in_progress" };

/**
 * Runs a money call once per key. The same key and body answers what the first call answered
 * (status 200); another body or route under the key is refused. Only a success is remembered, so a
 * partner can repeat a refused call under the same key after fixing the cause. Call with a client
 * that runs as the system.
 */
export async function runIdempotent(
  prisma: PrismaClient,
  partnerId: string,
  key: string,
  hash: string,
  run: () => Promise<{ status: number; body: unknown }>,
  now = new Date(),
): Promise<IdempotentOutcome> {
  await prisma.idempotencyRecord.deleteMany({
    where: { partnerId, key, expiresAt: { lt: now } },
  });
  try {
    await prisma.idempotencyRecord.create({
      data: { partnerId, key, requestHash: hash, expiresAt: new Date(now.getTime() + KEEP_MS) },
    });
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "P2002") throw error;
    const record = await prisma.idempotencyRecord.findUnique({
      where: { partnerId_key: { partnerId, key } },
    });
    if (!record) return runIdempotent(prisma, partnerId, key, hash, run, now);
    if (record.requestHash !== hash) return { kind: "conflict" };
    if (record.state === "done") {
      return { kind: "replay", status: 200, body: record.response };
    }
    if (now.getTime() - record.createdAt.getTime() < STALE_PENDING_MS) {
      return { kind: "in_progress" };
    }
  }
  try {
    const result = await run();
    if (result.status >= 200 && result.status < 300) {
      await prisma.idempotencyRecord.update({
        where: { partnerId_key: { partnerId, key } },
        data: { state: "done", status: result.status, response: result.body as never },
      });
    } else {
      await prisma.idempotencyRecord.deleteMany({ where: { partnerId, key, state: "pending" } });
    }
    return { kind: "ran", ...result };
  } catch (error) {
    await prisma.idempotencyRecord.deleteMany({ where: { partnerId, key, state: "pending" } });
    throw error;
  }
}

export async function purgeExpiredIdempotency(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  return (await prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } })).count;
}
