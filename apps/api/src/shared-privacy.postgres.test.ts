import { randomUUID } from "node:crypto";
import { FakeSandboxProvider } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  asSystem,
  createDb,
  createGroupRepos,
  createRepos,
  createThreadEvents,
  createThreadMessage,
  requireMembership,
  runAsTenant,
} from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

describePostgres("private channels and agent audiences hide what they should (PostgreSQL)", () => {
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

  /**
   * One space. `ana` owns it and made the private channel and the closed agent; `caio` holds the
   * "Sales" role they are both opened to; `bia` is a member with nothing; `dani` is an admin.
   */
  async function fixture() {
    const [ana, bia, caio, dani] = await Promise.all(
      ["Ana", "Bia", "Caio", "Dani"].map((name) => user(name)),
    );
    const orgId = randomUUID();
    organizations.push(orgId);
    await system.organization.create({
      data: { id: orgId, name: "Privacy fixture", slug: orgId, createdAt: new Date() },
    });
    const spaceId = randomUUID();
    await system.space.create({ data: { id: spaceId, organizationId: orgId, name: "Main" } });
    for (const [userId, role] of [
      [ana, "owner"],
      [bia, "member"],
      [caio, "member"],
      [dani, "admin"],
    ] as const) {
      await system.member.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          userId: userId!,
          role: "member",
          createdAt: new Date(),
        },
      });
      await system.spaceMember.create({
        data: {
          id: randomUUID(),
          spaceId,
          organizationId: orgId,
          userId: userId!,
          role,
          createdAt: new Date(),
        },
      });
    }
    const salesRoleId = randomUUID();
    await system.spaceRole.create({
      data: { id: salesRoleId, spaceId, name: "Sales", position: 1, keys: [] },
    });
    await system.spaceMemberRole.create({ data: { spaceId, userId: caio!, roleId: salesRoleId } });

    const owner: Actor = {
      userId: ana!,
      spaceId,
      email: "ana@example.test",
      isDeploymentOwner: false,
    };
    const made = await runAsTenant(owner, async () => {
      const repos = createRepos(prisma);
      const input = { title: "", description: "", instructions: "", notifyOnFinish: true };
      const open = await repos.createBot(owner, { ...input, name: "Open Helper" });
      const closed = await repos.createBot(owner, { ...input, name: "Closed Helper" });
      const group = await createGroupRepos(prisma).createGroup(owner, {
        name: "Secret room",
        botIds: [open.id, closed.id],
      });
      return { open, closed, group };
    });
    const secretWord = `zebrapass${Date.now()}`;
    const groupThread = made.group.threadId;
    const closedThread = made.closed.threadId!;
    await createThreadMessage(system, {
      threadId: groupThread,
      role: "user",
      blocks: [{ kind: "text", text: `the ${secretWord} is in the channel` }],
    });
    await createThreadMessage(system, {
      threadId: closedThread,
      role: "user",
      blocks: [{ kind: "text", text: `the ${secretWord} is in a closed chat` }],
    });

    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      sandbox: new FakeSandboxProvider(),
      env: { agentRuntime: "scripted" },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const call = async (userId: string, path: string, json?: unknown) => {
      const actor = await requireMembership(system, userId, spaceId);
      const { response } = await handler.handle(
        new Request(`http://127.0.0.1/rpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json === undefined ? {} : { json }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      const text = await response!.text();
      return {
        status: response!.status,
        text,
        body: text ? (JSON.parse(text) as { json: unknown }) : null,
      };
    };
    return {
      ana: ana!,
      bia: bia!,
      caio: caio!,
      dani: dani!,
      salesRoleId,
      secretWord,
      call,
      ...made,
    };
  }

  it("keeps a private channel out of every read for someone it is not opened to", async () => {
    const f = await fixture();
    const set = await f.call(f.ana, "groups/people/setRoles", {
      groupId: f.group.id,
      roleIds: [f.salesRoleId],
    });
    expect(set.status).toBe(200);
    // Someone who may not see it cannot change who does.
    expect(
      (await f.call(f.bia, "groups/people/setRoles", { groupId: f.group.id, roleIds: [] })).status,
    ).not.toBe(200);

    const listed = (who: string) =>
      f.call(who, "groups/list").then((res) => res.text.includes(f.group.id));
    expect(await listed(f.ana)).toBe(true); // its creator
    expect(await listed(f.caio)).toBe(true); // holds the granted role
    expect(await listed(f.dani)).toBe(true); // manage_channels
    expect(await listed(f.bia)).toBe(false);

    const read = (who: string) => f.call(who, "threads/messages", { groupId: f.group.id });
    expect((await read(f.caio)).status).toBe(200);
    expect((await read(f.bia)).status).not.toBe(200);
    expect((await f.call(f.bia, "threads/get", { groupId: f.group.id })).status).not.toBe(200);

    const searchHits = (who: string) =>
      f.call(who, "search/query", { q: f.secretWord }).then((res) => res.text);
    expect(await searchHits(f.caio)).toContain(f.group.id);
    expect(await searchHits(f.bia)).not.toContain(f.group.id);
    expect(
      (await f.call(f.bia, "search/query", { q: f.secretWord, within: { groupId: f.group.id } }))
        .text,
    ).not.toContain(f.secretWord);

    // A channel that is opened again is the space's again.
    await f.call(f.ana, "groups/people/open", { groupId: f.group.id });
    expect(await listed(f.bia)).toBe(true);
  });

  it("keeps an agent's chat for its audience, and the agent itself listed", async () => {
    const f = await fixture();
    const set = await f.call(f.ana, "bots/audience/set", {
      botId: f.closed.id,
      restricted: true,
      roleIds: [f.salesRoleId],
      userIds: [],
      consultable: true,
    });
    expect(set.status).toBe(200);
    // The audience is for its owner or manage_agents to change.
    expect(
      (
        await f.call(f.bia, "bots/audience/set", {
          botId: f.closed.id,
          restricted: false,
          roleIds: [],
          userIds: [],
          consultable: true,
        })
      ).status,
    ).not.toBe(200);

    const read = (who: string) => f.call(who, "threads/messages", { botId: f.closed.id });
    expect((await read(f.ana)).status).toBe(200);
    expect((await read(f.caio)).status).toBe(200);
    expect((await read(f.bia)).status).not.toBe(200);
    expect((await f.call(f.bia, "threads/messages", { botId: f.open.id })).status).toBe(200);

    expect((await f.call(f.bia, "bots/list")).text).toContain(f.closed.id);
    expect((await f.call(f.bia, "search/query", { q: f.secretWord })).text).not.toContain(
      `closed chat`,
    );
    expect((await f.call(f.caio, "search/query", { q: f.secretWord })).text).toContain(f.closed.id);
  });
});
