import { randomUUID } from "node:crypto";
import { FakeSandboxProvider } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, createThreadEvents, requireMembership } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

describePostgres("team procedures act on the space the request targets (PostgreSQL)", () => {
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
   * Two spaces, A (the person's selected one) and B. `ana` owns A and is only a member of B,
   * `bia` owns A and is an admin of B, `caio` belongs to A alone.
   */
  async function fixture() {
    const ana = await user("Ana");
    const bia = await user("Bia");
    const caio = await user("Caio");
    const orgId = randomUUID();
    organizations.push(orgId);
    await system.organization.create({
      data: { id: orgId, name: "Target fixture", slug: orgId, createdAt: new Date() },
    });
    const [a, b] = [randomUUID(), randomUUID()] as const;
    await system.space.create({ data: { id: a, organizationId: orgId, name: "A" } });
    await system.space.create({ data: { id: b, organizationId: orgId, name: "B" } });
    const memberships = [
      [ana, a, "owner"],
      [ana, b, "member"],
      [bia, a, "owner"],
      [bia, b, "admin"],
      [caio, a, "member"],
    ] as const;
    for (const userId of [ana, bia, caio]) {
      await system.member.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          userId,
          role: "member",
          createdAt: new Date(),
        },
      });
    }
    for (const [userId, spaceId, role] of memberships) {
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
    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      sandbox: new FakeSandboxProvider(),
      env: { agentRuntime: "scripted" },
      team: { prisma, secret: "test-secret", webOrigin: "http://127.0.0.1" },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    /** What the request middleware builds from the space header, whatever space was selected. */
    const call = async (userId: string, targetSpaceId: string, path: string, json?: unknown) => {
      let actor: Actor;
      try {
        actor = await requireMembership(system, userId, targetSpaceId);
      } catch {
        return { status: 401, body: null as unknown };
      }
      const { response } = await handler.handle(
        new Request(`http://127.0.0.1/rpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json === undefined ? {} : { json }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      const text = await response!.text();
      return { status: response!.status, body: text ? (JSON.parse(text) as unknown) : null };
    };
    return { ana, bia, caio, a, b, call };
  }

  it("lets an admin of B invite to B while A is their selected space", async () => {
    const f = await fixture();
    const created = await f.call(f.bia, f.b, "spaces/invitations/create", {
      addresses: "dora@example.test",
      role: "member",
    });
    expect(created.status).toBe(200);
    const rows = await system.spaceInvitation.findMany({ where: { email: "dora@example.test" } });
    expect(rows.map((row) => row.spaceId)).toEqual([f.b]);

    const members = await f.call(f.bia, f.b, "spaces/members/list");
    expect(members.status).toBe(200);
    expect(JSON.stringify(members.body)).toContain(f.ana);
    expect(JSON.stringify(members.body)).not.toContain(f.caio);
    expect((await f.call(f.bia, f.b, "spaces/inviteLink/create")).status).toBe(200);
    expect((await f.call(f.bia, f.b, "spaces/joinRequests/list")).status).toBe(200);
  });

  it("keeps a plain member of B from managing B, even as owner of A", async () => {
    const f = await fixture();
    for (const [path, json] of [
      ["spaces/invitations/list", undefined],
      ["spaces/invitations/create", { addresses: "dora@example.test", role: "member" }],
      ["spaces/inviteLink/create", undefined],
      ["spaces/joinRequests/list", undefined],
      ["spaces/members/setRole", { userId: f.bia, role: "member" }],
      ["spaces/members/remove", { userId: f.bia }],
    ] as const) {
      expect((await f.call(f.ana, f.b, path, json)).status).toBe(403);
    }
    expect(await system.spaceInvitation.count({ where: { spaceId: f.b } })).toBe(0);
    expect(await system.spaceMember.count({ where: { spaceId: f.b, userId: f.bia } })).toBe(1);
  });

  it("shows nothing about B to someone who does not belong to it", async () => {
    const f = await fixture();
    for (const path of ["spaces/members/list", "spaces/invitations/list"]) {
      const result = await f.call(f.caio, f.b, path);
      expect(result.status).toBe(401);
      expect(JSON.stringify(result.body)).not.toContain(f.bia);
    }
  });
});
