import { randomUUID } from "node:crypto";
import { FakeSandboxProvider } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, createThreadEvents } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

describePostgres("pausing a space (PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  let system: PrismaClient;
  const organizations: string[] = [];
  const users: string[] = [];

  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
    system = asSystem(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await system.organization.deleteMany({ where: { id: { in: organizations } } });
      await system.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
      await db.pool.end();
    }
  });

  async function user(label: string) {
    const id = randomUUID();
    users.push(id);
    await system.user.create({
      data: { id, name: label, email: `${id}@example.test`, emailVerified: true },
    });
    return id;
  }

  /** One organization with two spaces; `ownerId` owns both, `memberId` is only a member of the first. */
  async function fixture() {
    const ownerId = await user("Owner");
    const memberId = await user("Member");
    const orgId = randomUUID();
    organizations.push(orgId);
    await system.organization.create({
      data: { id: orgId, name: "Pause fixture", slug: orgId, createdAt: new Date() },
    });
    const spaces: string[] = [];
    for (const name of ["Paused", "Other"]) {
      const id = randomUUID();
      spaces.push(id);
      await system.space.create({ data: { id, organizationId: orgId, name } });
    }
    for (const [userId, role] of [
      [ownerId, "owner"],
      [memberId, "member"],
    ] as const) {
      await system.member.create({
        data: { id: randomUUID(), organizationId: orgId, userId, role, createdAt: new Date() },
      });
      for (const spaceId of userId === ownerId ? spaces : [spaces[0]!]) {
        await system.spaceMember.create({
          data: {
            id: randomUUID(),
            spaceId,
            organizationId: orgId,
            userId,
            role,
            createdAt: new Date(),
          },
        });
      }
    }
    const computer = await system.computer.create({
      data: {
        spaceId: spaces[0]!,
        userId: ownerId,
        scopeKey: orgId,
        homeKey: orgId,
        kind: "fake",
        state: "running",
      },
    });
    const runIn = async (spaceId: string, status: string) => {
      const bot = await system.bot.create({
        data: { spaceId, userId: ownerId, name: "Bot", color: "test", computerId: computer.id },
      });
      const thread = await system.thread.create({
        data: { spaceId, userId: ownerId, botId: bot.id },
      });
      const task = await system.task.create({
        data: {
          spaceId,
          userId: ownerId,
          botId: bot.id,
          threadId: thread.id,
          prompt: "go",
          status,
        },
      });
      return system.run.create({
        data: {
          spaceId,
          userId: ownerId,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          status,
          trigger: "user",
        },
      });
    };
    const runs = {
      running: await runIn(spaces[0]!, "running"),
      queued: await runIn(spaces[0]!, "queued"),
      waiting: await runIn(spaces[0]!, "waiting_input"),
      elsewhere: await runIn(spaces[1]!, "running"),
    };
    const actorOf = (userId: string, spaceId = spaces[0]!): Actor => ({
      spaceId,
      userId,
      email: `${userId}@example.test`,
      isDeploymentOwner: false,
    });
    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      sandbox: new FakeSandboxProvider(),
      env: { agentRuntime: "scripted" },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const setPaused = async (actor: Actor, spaceId: string, paused: boolean) => {
      const { response } = await handler.handle(
        new Request("http://127.0.0.1/rpc/spaces/setPaused", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { spaceId, paused } }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      return response!;
    };
    const statuses = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(runs).map(
            async ([key, run]) =>
              [
                key,
                (await system.run.findUniqueOrThrow({ where: { id: run.id } })).status,
              ] as const,
          ),
        ),
      );
    return { ownerId, memberId, spaces, runs, actorOf, setPaused, statuses };
  }

  it("pauses the space and cancels every active run in it", async () => {
    const f = await fixture();
    const response = await f.setPaused(f.actorOf(f.ownerId), f.spaces[0]!, true);
    expect(response.status).toBe(200);
    expect(await f.statuses()).toEqual({
      running: "cancelled",
      queued: "cancelled",
      waiting: "cancelled",
      elsewhere: "running",
    });
    const cancelledEvents = await system.event.findMany({
      where: { type: "run.cancelled", runId: { in: Object.values(f.runs).map((run) => run.id) } },
    });
    expect(cancelledEvents.map((event) => event.runId).sort()).toEqual(
      [f.runs.running.id, f.runs.queued.id, f.runs.waiting.id].sort(),
    );
    expect(
      (await system.space.findUniqueOrThrow({ where: { id: f.spaces[0]! } })).pausedAt,
    ).not.toBeNull();
    expect(
      (await system.space.findUniqueOrThrow({ where: { id: f.spaces[1]! } })).pausedAt,
    ).toBeNull();
  });

  it("refuses a member who is not the owner", async () => {
    const f = await fixture();
    const response = await f.setPaused(f.actorOf(f.memberId), f.spaces[0]!, true);
    expect(response.status).toBe(403);
    expect((await f.statuses()).running).toBe("running");
    expect(
      (await system.space.findUniqueOrThrow({ where: { id: f.spaces[0]! } })).pausedAt,
    ).toBeNull();
  });

  it("refuses a space the caller is not a member of", async () => {
    const f = await fixture();
    const response = await f.setPaused(f.actorOf(f.memberId), f.spaces[1]!, true);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await f.statuses()).elsewhere).toBe("running");
  });

  it("resumes without restarting anything", async () => {
    const f = await fixture();
    await f.setPaused(f.actorOf(f.ownerId), f.spaces[0]!, true);
    const response = await f.setPaused(f.actorOf(f.ownerId), f.spaces[0]!, false);
    expect(response.status).toBe(200);
    expect(
      (await system.space.findUniqueOrThrow({ where: { id: f.spaces[0]! } })).pausedAt,
    ).toBeNull();
    expect((await f.statuses()).running).toBe("cancelled");
  });
});
