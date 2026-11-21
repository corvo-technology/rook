import { describe, expect, it } from "vitest";
import {
  listSurfacedItems,
  recordSurfacedItem,
  runSurfacedItems,
  SURFACED_WINDOW_DAYS,
  surfacedItemsInstruction,
} from "./surfaced-items.js";

type Row = {
  id: string;
  spaceId: string;
  botId: string;
  threadId: string;
  key: string;
  fingerprint: string | null;
  summary: string;
  runId: string | null;
  surfacedAt: Date;
};

/** An in-memory stand-in for the one table the ledger uses. */
function fakeLedger(clock: { now: Date }) {
  const rows: Row[] = [];
  const find = (w: { botId_threadId_key: { botId: string; threadId: string; key: string } }) =>
    rows.find(
      (r) =>
        r.botId === w.botId_threadId_key.botId &&
        r.threadId === w.botId_threadId_key.threadId &&
        r.key === w.botId_threadId_key.key,
    );
  const surfacedItem = {
    findUnique: async ({ where }: any) => {
      const row = find(where);
      return row ? { ...row } : null;
    },
    upsert: async ({ where, create, update }: any) => {
      const row = find(where);
      if (row) Object.assign(row, update);
      else rows.push({ id: `s${rows.length}`, surfacedAt: clock.now, ...create });
    },
    count: async ({ where }: { where: { runId: string } }) =>
      rows.filter((r) => r.runId === where.runId).length,
    findMany: async ({ where }: any) =>
      rows
        .filter(
          (r) =>
            r.botId === where.botId &&
            r.threadId === where.threadId &&
            r.surfacedAt >= where.surfacedAt.gte,
        )
        .sort((a, b) => b.surfacedAt.getTime() - a.surfacedAt.getTime()),
  };
  return { prisma: { surfacedItem } as never, rows };
}

const item = {
  spaceId: "s1",
  botId: "chief",
  threadId: "t1",
  key: "calendar:conflict:2026-11-23",
  summary: "Carlos meeting overlaps the warm-up",
};

describe("surfaced items ledger", () => {
  it("records an item once and updates it in place when the same key comes back", async () => {
    const clock = { now: new Date("2026-11-20T10:00:00Z") };
    const { prisma, rows } = fakeLedger(clock);
    expect(await recordSurfacedItem(prisma, { ...item, fingerprint: "9:00" })).toEqual({
      key: item.key,
      changed: true,
    });
    // Same version: nothing material changed.
    expect(await recordSurfacedItem(prisma, { ...item, fingerprint: "9:00" })).toMatchObject({
      changed: false,
    });
    // A new version is a material change.
    expect(await recordSurfacedItem(prisma, { ...item, fingerprint: "10:00" })).toMatchObject({
      changed: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fingerprint).toBe("10:00");
  });

  it("keeps audiences apart and refuses an empty key or summary", async () => {
    const { prisma, rows } = fakeLedger({ now: new Date() });
    await recordSurfacedItem(prisma, item);
    await recordSurfacedItem(prisma, { ...item, threadId: "t2" });
    expect(rows).toHaveLength(2);
    expect(await recordSurfacedItem(prisma, { ...item, key: "  " })).toEqual({
      error: "key is required",
    });
    expect(await recordSurfacedItem(prisma, { ...item, summary: "" })).toEqual({
      error: "summary is required",
    });
  });

  it("lists only this audience's recent items and counts a run's notes", async () => {
    const clock = { now: new Date("2026-11-20T10:00:00Z") };
    const { prisma, rows } = fakeLedger(clock);
    await recordSurfacedItem(prisma, { ...item, runId: "r1" });
    await recordSurfacedItem(prisma, { ...item, key: "old", summary: "old" });
    rows[1]!.surfacedAt = new Date(clock.now.getTime() - (SURFACED_WINDOW_DAYS + 1) * 86_400_000);
    const listed = await listSurfacedItems(prisma, { botId: "chief", threadId: "t1" }, clock.now);
    expect(listed.map((row) => row.key)).toEqual([item.key]);
    expect(await runSurfacedItems(prisma, "r1")).toBe(1);
    expect(await runSurfacedItems(prisma, "r2")).toBe(0);
  });

  it("shows the ledger to the agent, or nothing when it is empty", () => {
    expect(surfacedItemsInstruction([])).toBeUndefined();
    const text = surfacedItemsInstruction([
      {
        key: item.key,
        fingerprint: "9:00",
        summary: item.summary,
        surfacedAt: new Date("2026-11-20"),
      },
    ]);
    expect(text).toContain("calendar:conflict:2026-11-23 [9:00]: Carlos meeting overlaps");
    expect(text).toContain("note_surfaced");
  });
});
