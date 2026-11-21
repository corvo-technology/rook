import { RoutineWatchSchema } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { createChiefWatchReconciler, ensureChiefWatch, ensureChiefWatches } from "./chief-watch.js";

/** In-memory routines and bots with the unique (bot, template key) rule. */
function fakeDb(chiefs: Array<{ id: string; spaceId: string; userId: string }>) {
  const routines: Array<Record<string, unknown>> = [];
  const bots = chiefs.map((chief) => ({ ...chief, chiefWatchAt: null as Date | null }));
  const prisma = {
    user: { findUnique: async () => ({ timezone: "America/Sao_Paulo" }) },
    routine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (routines.some((r) => r.botId === data.botId && r.templateKey === data.templateKey)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        routines.push(data);
      },
    },
    bot: {
      update: async ({ where, data }: { where: { id: string }; data: { chiefWatchAt: Date } }) => {
        Object.assign(bots.find((b) => b.id === where.id)!, data);
      },
      findMany: async ({ take }: { take: number }) =>
        bots.filter((b) => b.chiefWatchAt === null).slice(0, take),
    },
  };
  return { prisma: prisma as never, routines, bots };
}

const now = new Date("2026-11-20T10:00:00Z");

describe("ensureChiefWatch", () => {
  it("makes one active, approval-free board watch for the Chief every half hour", async () => {
    const { prisma, routines, bots } = fakeDb([{ id: "c1", spaceId: "s", userId: "u" }]);
    expect(await ensureChiefWatch(prisma, bots[0]!, now)).toEqual({ created: true });
    expect(routines).toHaveLength(1);
    const [routine] = routines;
    expect(routine).toMatchObject({
      botId: "c1",
      active: true,
      crons: [],
      timezone: "America/Sao_Paulo",
      templateKey: "chief-watch",
    });
    expect(RoutineWatchSchema.parse(routine!.watch)).toMatchObject({
      kind: "board",
      everyMinutes: 30,
      loud: false,
    });
    expect((routine!.nextRunAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(bots[0]!.chiefWatchAt).toEqual(now);
  });

  it("is idempotent: a second call, or a lost race, makes nothing more", async () => {
    const { prisma, routines, bots } = fakeDb([{ id: "c1", spaceId: "s", userId: "u" }]);
    await ensureChiefWatch(prisma, bots[0]!, now);
    expect(await ensureChiefWatch(prisma, bots[0]!, now)).toEqual({ created: false });
    expect(routines).toHaveLength(1);
  });
});

describe("ensureChiefWatches (backfill)", () => {
  it("gives every Chief without a watch one, once, and leaves a deleted watch deleted", async () => {
    const { prisma, routines } = fakeDb([
      { id: "c1", spaceId: "s1", userId: "u1" },
      { id: "c2", spaceId: "s2", userId: "u2" },
    ]);
    expect(await ensureChiefWatches(prisma, { now })).toBe(2);
    expect(await ensureChiefWatches(prisma, { now })).toBe(0);
    // The person deletes one; the Chief is already marked, so it is not made again.
    routines.shift();
    expect(await ensureChiefWatches(prisma, { now })).toBe(0);
    expect(routines).toHaveLength(1);
  });

  it("runs at most once per interval from the reconciler", async () => {
    const { prisma, routines, bots } = fakeDb([{ id: "c1", spaceId: "s", userId: "u" }]);
    const sweep = createChiefWatchReconciler(prisma, 60_000);
    await sweep();
    bots.push({ id: "c2", spaceId: "s2", userId: "u2", chiefWatchAt: null });
    await sweep();
    expect(routines).toHaveLength(1);
  });
});
