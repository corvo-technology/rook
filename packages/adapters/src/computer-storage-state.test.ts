import { describe, expect, it, vi } from "vitest";
import {
  botsOnFullComputers,
  claimStorageWarning,
  clearComputerFull,
  clearComputerFullWhenRoom,
  markComputerFull,
  STORAGE_BACKOFF_MS,
  STORAGE_WARN_INTERVAL_MS,
} from "./computer-storage-state.js";

const NOW = new Date("2026-11-20T20:00:00Z");

/** An in-memory computer row that understands the few filters these helpers use. */
function computers() {
  const row: { id: string; storageFullAt: Date | null; storageWarnedAt: Date | null } = {
    id: "c1",
    storageFullAt: null,
    storageWarnedAt: null,
  };
  const updateMany = vi.fn(async ({ where, data }: { where: any; data: any }) => {
    if (where.id !== row.id) return { count: 0 };
    if (where.storageFullAt?.not === null && row.storageFullAt === null) return { count: 0 };
    if (where.OR) {
      const ok = where.OR.some((clause: any) =>
        "storageWarnedAt" in clause && clause.storageWarnedAt === null
          ? row.storageWarnedAt === null
          : row.storageWarnedAt !== null && row.storageWarnedAt < clause.storageWarnedAt.lt,
      );
      if (!ok) return { count: 0 };
    }
    Object.assign(row, data);
    return { count: 1 };
  });
  const bot = {
    findMany: vi.fn(async ({ where }: { where: any }) => {
      const since: Date = where.computer.storageFullAt.gt;
      const full = row.storageFullAt !== null && row.storageFullAt > since;
      return full && (!where.id || where.id.in.includes("rafa")) ? [{ id: "rafa" }] : [];
    }),
  };
  return { row, db: { computer: { updateMany }, bot } as never, bot };
}

describe("computer back-off", () => {
  it("holds automatic runs while the computer is full, then lets one try after the cool-down", async () => {
    const { row, db } = computers();
    expect(await botsOnFullComputers(db, ["rafa"], NOW)).toEqual(new Set());
    await markComputerFull(db, "c1", NOW);
    expect(row.storageFullAt).toEqual(NOW);
    const during = new Date(NOW.getTime() + STORAGE_BACKOFF_MS - 1000);
    expect(await botsOnFullComputers(db, ["rafa"], during)).toEqual(new Set(["rafa"]));
    expect(await botsOnFullComputers(db, undefined, during)).toEqual(new Set(["rafa"]));
    const after = new Date(NOW.getTime() + STORAGE_BACKOFF_MS + 1000);
    expect(await botsOnFullComputers(db, ["rafa"], after)).toEqual(new Set());
  });

  it("clears as soon as space is freed", async () => {
    const { row, db } = computers();
    await markComputerFull(db, "c1", NOW);
    await clearComputerFull(db, "c1");
    expect(row.storageFullAt).toBeNull();
    expect(await botsOnFullComputers(db, ["rafa"], NOW)).toEqual(new Set());
  });

  it("asks nothing for no agents", async () => {
    const { db, bot } = computers();
    expect(await botsOnFullComputers(db, [], NOW)).toEqual(new Set());
    expect(bot.findMany).not.toHaveBeenCalled();
  });
});

describe("claimStorageWarning", () => {
  it("lets one caller warn per computer per day", async () => {
    const { row, db } = computers();
    expect(await claimStorageWarning(db, "c1", NOW)).toBe(true);
    expect(row.storageWarnedAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + 60 * 60_000);
    expect(await claimStorageWarning(db, "c1", later)).toBe(false);
    const nextDay = new Date(NOW.getTime() + STORAGE_WARN_INTERVAL_MS + 1000);
    expect(await claimStorageWarning(db, "c1", nextDay)).toBe(true);
  });
});

describe("clearComputerFullWhenRoom", () => {
  it("clears the back-off after Free up space left room, and keeps it when it did not", async () => {
    const { row, db } = computers();
    await markComputerFull(db, "c1", NOW);
    expect(await clearComputerFullWhenRoom(db, "c1", 100 * 1024 * 1024)).toBe(false);
    expect(await clearComputerFullWhenRoom(db, "c1", null)).toBe(false);
    expect(row.storageFullAt).toEqual(NOW);
    expect(await clearComputerFullWhenRoom(db, "c1", 400 * 1024 * 1024)).toBe(true);
    expect(row.storageFullAt).toBeNull();
  });
});
