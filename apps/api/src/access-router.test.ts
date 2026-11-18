import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: a fake Prisma client drives the real router handlers and permission checks.

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

type Rows = {
  servers?: unknown[];
  mailboxes?: unknown[];
  databases?: unknown[];
  partnerGrants?: unknown[];
  /** Whether the space's organization is a member of a partner. */
  partnerMember?: boolean;
};

function setup(role: string, rows: Rows = {}) {
  const ownedBots = ["bot-1", "bot-2"];
  const prisma = {
    spaceMember: { findUnique: vi.fn(async () => ({ role, roles: [] })) },
    spaceRole: { findMany: vi.fn(async () => []) },
    bot: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; userId?: string } }) =>
        where.id.in
          .filter((id) => ownedBots.includes(id) || (!where.userId && id === "bot-shared"))
          .map((id) => ({ id })),
      ),
    },
    mcpServer: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === "srv-1" && where.userId === "user-1" ? { id: "srv-1" } : null,
      ),
    },
    mailbox: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "mbx-1" ? { id: "mbx-1" } : null,
      ),
    },
    databaseConnection: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "db-1" ? { id: "db-1" } : null,
      ),
    },
    botMcpServer: {
      findMany: vi.fn(async () => rows.servers ?? []),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    botMailbox: {
      findMany: vi.fn(async () => rows.mailboxes ?? []),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    botDatabaseGrant: {
      findMany: vi.fn(async () => rows.databases ?? []),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    space: { findUnique: vi.fn(async () => ({ organizationId: "org-1" })) },
    partnerMember: {
      findMany: vi.fn(async () =>
        rows.partnerMember
          ? [
              {
                partner: {
                  id: "p1",
                  slug: "p1",
                  name: "P1",
                  mode: "embedded",
                  createdAt: new Date(),
                },
              },
            ]
          : [],
      ),
    },
    botPartnerGrant: {
      findMany: vi.fn(async () => rows.partnerGrants ?? []),
      createMany: vi.fn(async () => ({ count: 0 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    // Cards of a removed grant are looked up by message; there are none here.
    message: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 0 })) },
    thread: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    events: { notify: vi.fn(async () => undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(path: string, input?: unknown) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/access/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  }
  return { prisma, call };
}

describe("access.list", () => {
  it("reports one level per agent and connection, and custom for a per-tool list", async () => {
    const { call } = setup("member", {
      servers: [
        { botId: "bot-1", serverId: "srv-1", allowAllTools: true, level: "write" },
        { botId: "bot-2", serverId: "srv-1", allowAllTools: true, level: "read" },
        { botId: "bot-3", serverId: "srv-1", allowAllTools: false, level: "write" },
      ],
      mailboxes: [{ botId: "bot-1", mailboxId: "mbx-1", level: "read" }],
      databases: [{ botId: "bot-1", connectionId: "db-1" }],
    });
    const result = await call("list");
    expect(result.status).toBe(200);
    // A member without manage_connections never sees a database.
    expect(result.body).toEqual([
      { kind: "mcp", connectionId: "srv-1", botId: "bot-1", level: "write" },
      { kind: "mcp", connectionId: "srv-1", botId: "bot-2", level: "read" },
      { kind: "mcp", connectionId: "srv-1", botId: "bot-3", level: "custom" },
      { kind: "mailbox", connectionId: "mbx-1", botId: "bot-1", level: "read" },
    ]);
  });

  it("includes databases for someone who manages connections, always as read", async () => {
    const { call } = setup("admin", {
      databases: [{ botId: "bot-1", connectionId: "db-1" }],
    });
    expect((await call("list")).body).toEqual([
      { kind: "database", connectionId: "db-1", botId: "bot-1", level: "read" },
    ]);
  });
});

describe("access.set", () => {
  it("grants an MCP server at read and replaces a per-tool list from an older version", async () => {
    const { call, prisma } = setup("member");
    const result = await call("set", {
      kind: "mcp",
      connectionId: "srv-1",
      botIds: ["bot-1", "bot-2"],
      level: "read",
    });
    expect(result.status).toBe(200);
    expect(prisma.botMcpServer.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ botId: "bot-1", level: "read", allowAllTools: true }),
          expect.objectContaining({ botId: "bot-2", level: "read", allowAllTools: true }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(prisma.botMcpServer.updateMany).toHaveBeenCalledWith({
      where: { serverId: "srv-1", botId: { in: ["bot-1", "bot-2"] } },
      data: { allowAllTools: true, allowedTools: [], level: "read" },
    });
  });

  it("takes access away at none", async () => {
    const { call, prisma } = setup("member");
    await call("set", { kind: "mcp", connectionId: "srv-1", botIds: ["bot-1"], level: "none" });
    expect(prisma.botMcpServer.deleteMany).toHaveBeenCalledWith({
      where: { serverId: "srv-1", botId: { in: ["bot-1"] } },
    });
    expect(prisma.botMcpServer.createMany).not.toHaveBeenCalled();
  });

  it("refuses a server that is not the actor's and an agent that is not theirs", async () => {
    const { call, prisma } = setup("member");
    const other = await call("set", {
      kind: "mcp",
      connectionId: "srv-other",
      botIds: ["bot-1"],
      level: "read",
    });
    const foreign = await call("set", {
      kind: "mcp",
      connectionId: "srv-1",
      botIds: ["bot-shared"],
      level: "read",
    });
    expect(other.status).toBeGreaterThanOrEqual(400);
    expect(foreign.status).toBeGreaterThanOrEqual(400);
    expect(prisma.botMcpServer.createMany).not.toHaveBeenCalled();
  });

  it("sets a mailbox level", async () => {
    const { call, prisma } = setup("member");
    await call("set", {
      kind: "mailbox",
      connectionId: "mbx-1",
      botIds: ["bot-1"],
      level: "write",
    });
    expect(prisma.botMailbox.updateMany).toHaveBeenCalledWith({
      where: { mailboxId: "mbx-1", botId: { in: ["bot-1"] } },
      data: { level: "write" },
    });
  });

  it("offers a database only read, and only to people who manage connections", async () => {
    const member = setup("member");
    const refused = await member.call("set", {
      kind: "database",
      connectionId: "db-1",
      botIds: ["bot-1"],
      level: "read",
    });
    expect(refused.status).toBe(403);
    expect(member.prisma.botDatabaseGrant.createMany).not.toHaveBeenCalled();

    const admin = setup("admin");
    const write = await admin.call("set", {
      kind: "database",
      connectionId: "db-1",
      botIds: ["bot-1"],
      level: "write",
    });
    expect(write.status).toBe(400);
    const read = await admin.call("set", {
      kind: "database",
      connectionId: "db-1",
      botIds: ["bot-1"],
      level: "read",
    });
    expect(read.status).toBe(200);
    expect(admin.prisma.botDatabaseGrant.createMany).toHaveBeenCalledOnce();
  });
});

describe("the partner connection", () => {
  const grants = [{ botId: "bot-1", level: "read" }];
  const set = (level: string, connectionId = "partner") => ({
    kind: "partner",
    connectionId,
    botIds: ["bot-1"],
    level,
  });

  it("lists its grants only for someone who manages the partner, in an organization that has one", async () => {
    const managed = setup("admin", { partnerMember: true, partnerGrants: grants });
    expect((await managed.call("list")).body).toEqual([
      { kind: "partner", connectionId: "partner", botId: "bot-1", level: "read" },
    ]);
    const member = setup("member", { partnerMember: true, partnerGrants: grants });
    expect((await member.call("list")).body).toEqual([]);
    const noPartner = setup("admin", { partnerGrants: grants });
    expect((await noPartner.call("list")).body).toEqual([]);
  });

  it("sets a level for the partner connection and takes it away at none", async () => {
    const { call, prisma } = setup("admin", { partnerMember: true });
    expect((await call("set", set("write"))).status).toBe(200);
    expect(prisma.botPartnerGrant.updateMany).toHaveBeenCalledWith({
      where: { botId: { in: ["bot-1"] } },
      data: { level: "write" },
    });
    await call("set", set("none"));
    expect(prisma.botPartnerGrant.deleteMany).toHaveBeenCalledWith({
      where: { botId: { in: ["bot-1"] } },
    });
  });

  it("refuses a member without manage_partner, another connection, and an organization with no partner", async () => {
    const member = setup("member", { partnerMember: true });
    expect((await member.call("set", set("read"))).status).toBe(403);
    const admin = setup("admin", { partnerMember: true });
    expect((await admin.call("set", set("read", "partner-other"))).status).toBeGreaterThanOrEqual(
      400,
    );
    const none = setup("admin");
    expect((await none.call("set", set("read"))).status).toBeGreaterThanOrEqual(400);
    for (const fake of [member, admin, none]) {
      expect(fake.prisma.botPartnerGrant.createMany).not.toHaveBeenCalled();
    }
  });
});
