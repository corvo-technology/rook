import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapUserSpace } from "./bootstrap-user.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  completeMission,
  markPartSeen,
  readMissions,
  showAllNavigation,
  startShortNavigation,
} from "./missions.js";
import { asSystem, runAsTenant } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const env = { signupsEnabled: "true", signupAllowlist: "" };

describePostgres("missions (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let counter = 0;

  beforeAll(() => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
  });

  afterAll(async () => {
    await close?.();
  });

  async function account(started = true) {
    counter += 1;
    // The personal space is named from the first characters of the user id, so they must differ.
    const userId = `${randomUUID().replaceAll("-", "")}-${suffix}-${counter}`;
    await system.user.create({
      data: {
        id: userId,
        name: "Missions Test",
        email: `${userId}@corvo.test`,
        emailVerified: false,
      },
    });
    const { spaceId } = await bootstrapUserSpace(prisma, { id: userId }, env);
    if (!started) await system.missionState.deleteMany({ where: { spaceId } });
    const scope = { spaceId, userId };
    const read = () => runAsTenant(scope, () => readMissions(prisma, scope));
    return { scope, read };
  }

  async function bot(scope: { spaceId: string; userId: string }, archived = false) {
    return system.bot.create({
      data: { ...scope, name: "Agent", color: "blue", archivedAt: archived ? new Date() : null },
    });
  }

  async function run(scope: { spaceId: string; userId: string }, trigger: string, status: string) {
    const b = await bot(scope);
    const thread = await system.thread.create({ data: { ...scope, botId: b.id } });
    const task = await system.task.create({
      data: { ...scope, botId: b.id, threadId: thread.id, prompt: "hi", status: "done" },
    });
    await system.run.create({
      data: { ...scope, botId: b.id, threadId: thread.id, taskId: task.id, status, trigger },
    });
  }

  async function routine(scope: { spaceId: string; userId: string }) {
    const b = await bot(scope);
    return system.routine.create({
      data: { ...scope, botId: b.id, name: "Daily", prompt: "do", crons: [] },
    });
  }

  it("does nothing for a member without a row", async () => {
    const { scope, read } = await account(false);
    expect(await read()).toBeNull();
    await runAsTenant(scope, async () => {
      await completeMission(prisma, scope, "talk");
      await markPartSeen(prisma, scope, "usage");
      await showAllNavigation(prisma, scope);
    });
    expect(await system.missionState.count({ where: scope })).toBe(0);
  });

  it("starts for a new account once", async () => {
    const { scope } = await account();
    await bootstrapUserSpace(prisma, { id: scope.userId }, env);
    expect(await system.missionState.count({ where: scope })).toBe(1);
  });

  it("does not start for a space that was already there", async () => {
    const { scope } = await account(false);
    await bootstrapUserSpace(prisma, { id: scope.userId }, env);
    expect(await system.missionState.count({ where: scope })).toBe(0);
  });

  it("ignores a second start", async () => {
    const { scope } = await account();
    await startShortNavigation(system, scope);
    expect(await system.missionState.count({ where: scope })).toBe(1);
  });

  it("starts empty, and the seeded memory does not count", async () => {
    const { read } = await account();
    expect(await read()).toEqual({ short: true, completed: [], has: [], seen: [] });
  });

  it("latches a routine after it is deleted", async () => {
    const { scope, read } = await account();
    const created = await routine(scope);
    const view = await read();
    expect(view?.completed).toContain("routine");
    expect(view?.has).toContain("routines");
    await system.routine.delete({ where: { id: created.id } });
    const after = await read();
    expect(after?.completed).toContain("routine");
    expect(after?.has).not.toContain("routines");
  });

  it("counts only a run a person started and that completed", async () => {
    const { scope, read } = await account();
    await run(scope, "created", "completed");
    await run(scope, "user", "failed");
    expect((await read())?.completed).not.toContain("talk");
    await run(scope, "user", "completed");
    expect((await read())?.completed).toContain("talk");
  });

  it("needs two unarchived agents for the second", async () => {
    const { scope, read } = await account();
    await bot(scope);
    expect((await read())?.completed).not.toContain("second");
    await bot(scope, true);
    expect((await read())?.completed).not.toContain("second");
    await bot(scope);
    expect((await read())?.completed).toContain("second");
  });

  it("does not count a pending connection", async () => {
    const { scope, read } = await account();
    const data = { ...scope, provider: "demo", displayName: "Demo" };
    await system.connection.create({ data: { ...data, status: "pending" } });
    expect((await read())?.completed).not.toContain("connect");
    await system.connection.create({ data: { ...data, status: "connected" } });
    expect((await read())?.completed).toContain("connect");
  });

  it("counts a memory document that was edited", async () => {
    const { scope, read } = await account();
    await system.memoryDocument.updateMany({ where: scope, data: { revision: 2 } });
    const view = await read();
    expect(view?.completed).toContain("memory");
    expect(view?.has).toContain("memory");
  });

  it("ignores another member's routine in the same space", async () => {
    const { scope, read } = await account();
    await routine({ spaceId: scope.spaceId, userId: `${scope.userId}-other` });
    expect((await read())?.completed).toEqual([]);
  });

  it("records a seen part once under parallel calls", async () => {
    const { scope } = await account();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        runAsTenant(scope, () => markPartSeen(prisma, scope, "usage")),
      ),
    );
    const row = await system.missionState.findUniqueOrThrow({
      where: { spaceId_userId: scope },
    });
    expect(row.seenParts).toEqual(["usage"]);
  });

  it("lists a mission once when reads race", async () => {
    const { scope, read } = await account();
    await routine(scope);
    await Promise.all([read(), read(), read(), read()]);
    await runAsTenant(scope, () => completeMission(prisma, scope, "routine"));
    const row = await system.missionState.findUniqueOrThrow({
      where: { spaceId_userId: scope },
    });
    expect(row.completed).toEqual(["routine"]);
  });

  it("records an answered request", async () => {
    const { scope, read } = await account();
    await runAsTenant(scope, () => completeMission(prisma, scope, "decide"));
    expect((await read())?.completed).toEqual(["decide"]);
  });

  it("ends short mode once and keeps the first time", async () => {
    const { scope, read } = await account();
    await runAsTenant(scope, () => showAllNavigation(prisma, scope));
    const first = await system.missionState.findUniqueOrThrow({
      where: { spaceId_userId: scope },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await runAsTenant(scope, () => showAllNavigation(prisma, scope));
    const second = await system.missionState.findUniqueOrThrow({
      where: { spaceId_userId: scope },
    });
    expect(second.shownAllAt).toEqual(first.shownAllAt);
    expect((await read())?.short).toBe(false);
  });
});
