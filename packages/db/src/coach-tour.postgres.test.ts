import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { markTourDone, skipTour } from "./coach-tour.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("coach tour (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  const userIds: string[] = [];
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  const newUser = async (label: string) => {
    const id = `tour-${label}-${stamp}`;
    userIds.push(id);
    await asSystem(prisma, "test fixture").user.create({
      data: { id, name: "Tour", email: `${id}@corvo.test`, emailVerified: false },
    });
    return id;
  };
  const row = (userId: string) =>
    asSystem(prisma, "test fixture").coachTour.findUnique({
      where: { userId },
      select: { done: true, skipped: true },
    });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
  });

  afterAll(async () => {
    if (prisma) {
      await asSystem(prisma, "test fixture cleanup").user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
    await close?.();
  });

  it("has no row for an account created after the migration", async () => {
    expect(await row(await newUser("fresh"))).toBeNull();
  });

  it("stores a mark once, even when repeated", async () => {
    const id = await newUser("once");
    await markTourDone(prisma, id, "first");
    expect(await row(id)).toEqual({ done: ["first"], skipped: false });
    await markTourDone(prisma, id, "first");
    expect(await row(id)).toEqual({ done: ["first"], skipped: false });
  });

  it("stores a mark once under parallel calls", async () => {
    const id = await newUser("parallel");
    await Promise.all(Array.from({ length: 10 }, () => markTourDone(prisma, id, "chief")));
    expect(await row(id)).toEqual({ done: ["chief"], skipped: false });
  });

  it("keeps the marks done when the tour is skipped, twice", async () => {
    const id = await newUser("skip");
    await markTourDone(prisma, id, "ask");
    await skipTour(prisma, id);
    await skipTour(prisma, id);
    expect(await row(id)).toEqual({ done: ["ask"], skipped: true });
  });

  it("is deleted with the user", async () => {
    const id = await newUser("cascade");
    await skipTour(prisma, id);
    await asSystem(prisma, "test fixture").user.delete({ where: { id } });
    expect(await row(id)).toBeNull();
  });
});
