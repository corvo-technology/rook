import type { PrismaClient } from "@corvo/db";
import { MIN_FREE_BYTES } from "./computer-storage.js";

/**
 * How long a computer that found no room is left alone by automatic starts (the ticket sweep,
 * follow-up runs). Freeing space clears it sooner; afterwards one run tries again.
 */
export const STORAGE_BACKOFF_MS = 30 * 60_000;
/** The owner hears that a computer is nearly full at most once in this long. */
export const STORAGE_WARN_INTERVAL_MS = 24 * 60 * 60_000;

type Db = Pick<PrismaClient, "computer">;

/** A start found the computer full: automatic runs on it wait. */
export async function markComputerFull(
  db: Db,
  computerId: string,
  now = new Date(),
): Promise<void> {
  await db.computer.updateMany({ where: { id: computerId }, data: { storageFullAt: now } });
}

/** There is room again (a start passed or space was freed): automatic runs may start. */
export async function clearComputerFull(db: Db, computerId: string): Promise<void> {
  await db.computer.updateMany({
    where: { id: computerId, storageFullAt: { not: null } },
    data: { storageFullAt: null },
  });
}

/**
 * After a clean-up on request: with room for a run to start again, automatic runs may start on
 * the computer without waiting out the cool-down. Returns whether the back-off was cleared.
 */
export async function clearComputerFullWhenRoom(
  db: Db,
  computerId: string,
  freeBytes: number | null,
): Promise<boolean> {
  if (freeBytes === null || freeBytes < MIN_FREE_BYTES) return false;
  await clearComputerFull(db, computerId);
  return true;
}

/** The agents (among `botIds`, or all) whose computer is full and still backing off. */
export async function botsOnFullComputers(
  db: Pick<PrismaClient, "bot">,
  botIds?: readonly string[],
  now = new Date(),
): Promise<Set<string>> {
  if (botIds?.length === 0) return new Set();
  const since = new Date(now.getTime() - STORAGE_BACKOFF_MS);
  const rows = await db.bot.findMany({
    where: {
      ...(botIds ? { id: { in: [...botIds] } } : {}),
      computer: { storageFullAt: { gt: since } },
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/**
 * Claims today's warning for a computer. True for the one caller that should tell the owner;
 * false when someone did in the last day.
 */
export async function claimStorageWarning(
  db: Db,
  computerId: string,
  now = new Date(),
): Promise<boolean> {
  const since = new Date(now.getTime() - STORAGE_WARN_INTERVAL_MS);
  const claimed = await db.computer.updateMany({
    where: {
      id: computerId,
      OR: [{ storageWarnedAt: null }, { storageWarnedAt: { lt: since } }],
    },
    data: { storageWarnedAt: now },
  });
  return claimed.count === 1;
}
