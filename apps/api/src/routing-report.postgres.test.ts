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

describePostgres(
  "a channel message keeps its routing report inside the channel (PostgreSQL)",
  () => {
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
      await system.spaceMemberRole.create({
        data: { spaceId, userId: caio!, roleId: salesRoleId },
      });

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
      await createThreadMessage(system, {
        threadId: groupThread,
        role: "user",
        blocks: [{ kind: "text", text: `the ${secretWord} is in the channel` }],
        routingReport: {
          by: "router",
          note: "fits the question",
          agents: [{ botId: made.open.id, reason: "router_picked" }],
        },
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
        spaceId,
        secretWord,
        call,
        ...made,
      };
    }

    it("keeps the report with the channel's space", async () => {
      const f = await fixture();
      const read = (who: string) => f.call(who, "threads/messages", { groupId: f.group.id });
      const mine = await read(f.ana);
      expect(mine.status).toBe(200);
      expect(mine.text).toContain("router_picked");
      expect(mine.text).toContain("fits the question");

      // The row is read under the space's own row security, and no other space sees it.
      const rowsIn = (spaceId: string) =>
        runAsTenant(
          { userId: f.ana, spaceId, email: "ana@example.test", isDeploymentOwner: false },
          () =>
            prisma.message.findMany({
              where: { threadId: f.group.threadId },
              select: { routingReport: true },
            }),
        );
      expect(await rowsIn(f.spaceId)).toEqual([
        {
          routingReport: {
            by: "router",
            note: "fits the question",
            agents: [{ botId: f.open.id, reason: "router_picked" }],
          },
        },
      ]);
      expect(await rowsIn(randomUUID())).toEqual([]);
    });
  },
);
