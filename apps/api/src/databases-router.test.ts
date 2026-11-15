import type { DatabaseDriver } from "@corvo/adapters";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: a fake Prisma client, secret store and database driver drive the real
// router handlers and the real permission check.

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

const PASSWORD = "db-password-SENTINEL-1";
const CONNECTION_STRING = `postgres://reader:${PASSWORD}@db.example.test:5432/sales`;

function setup(role: string, probeFails = false) {
  const connections: Array<Record<string, unknown>> = [];
  const grants: Array<{ botId: string; connectionId: string }> = [];
  const secrets: Array<Record<string, unknown>> = [];
  const withGrants = (row: Record<string, unknown>) => ({
    ...row,
    grants: grants.filter((grant) => grant.connectionId === row.id),
  });
  const prisma = {
    spaceMember: { findUnique: vi.fn(async () => ({ role, roles: [] })) },
    spaceRole: { findMany: vi.fn(async () => []) },
    secret: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        secrets.push(data);
        return data;
      }),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    bot: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] }; spaceId: string } }) =>
        where.spaceId === "space-1"
          ? where.id.in.filter((id) => id.startsWith("bot-mine")).map((id) => ({ id }))
          : [],
      ),
    },
    databaseConnection: {
      findMany: vi.fn(async () => connections.map(withGrants)),
      findFirst: vi.fn(async ({ where }: { where: { id: string; spaceId: string } }) => {
        const row = connections.find((c) => c.id === where.id && c.spaceId === where.spaceId);
        return row ? withGrants(row) : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        withGrants(connections.find((c) => c.id === where.id) ?? {}),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "conn-1", createdAt: new Date(0), ...data };
        connections.push(row);
        return withGrants(row);
      }),
      delete: vi.fn(async () => ({})),
    },
    botDatabaseGrant: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ botId: string; connectionId: string }> }) => {
          grants.push(...data);
          return { count: data.length };
        },
      ),
    },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const driver: DatabaseDriver = {
    session: vi.fn(async (_target, run) => {
      if (probeFails) throw new Error(`password authentication failed (${PASSWORD})`);
      return run({
        async exec() {},
        async read() {
          return { columns: ["?column?"], rows: [[1]], more: false };
        },
      });
    }) as DatabaseDriver["session"],
    evict: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const store = {
    put: vi.fn(async (_plaintext: string, _context: unknown) => ({
      id: "secret-1",
      ref: "enc:secret-1",
      ciphertext: "enc:secret-1",
    })),
    load: vi.fn(),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    secrets: store,
    databaseDriver: driver,
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
      new Request(`http://127.0.0.1/rpc/databases/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, text };
  }
  return { prisma, store, driver, connections, call };
}

describe("databases router", () => {
  it("lets only members with manage_connections touch connections", async () => {
    const { call, store, prisma } = setup("member");
    for (const [path, input] of [
      ["list", undefined],
      ["create", { name: "Sales", connectionString: CONNECTION_STRING }],
      ["test", { id: "conn-1" }],
      ["remove", { id: "conn-1" }],
      ["setGrants", { id: "conn-1", botIds: [] }],
    ] as const) {
      const result = await call(path, input);
      expect(result.status).toBe(403);
      expect(result.text).not.toContain(PASSWORD);
    }
    expect(store.put).not.toHaveBeenCalled();
    expect(prisma.databaseConnection.create).not.toHaveBeenCalled();
  });

  it("tests the connection on save, stores the password encrypted, and never returns it", async () => {
    const { call, store, prisma, driver } = setup("admin");
    const result = await call("create", { name: "Sales", connectionString: CONNECTION_STRING });
    expect(result.status).toBe(200);
    expect(result.text).not.toContain(PASSWORD);
    expect(JSON.parse(result.text).json).toMatchObject({
      name: "Sales",
      host: "db.example.test",
      database: "sales",
      user: "reader",
      sslMode: "require",
      testedOk: true,
      botIds: [],
    });
    expect(driver.session).toHaveBeenCalledOnce();
    expect(store.put.mock.calls[0]?.[0]).toBe(PASSWORD);
    const stored = JSON.stringify(prisma.databaseConnection.create.mock.calls[0]);
    expect(stored).not.toContain(PASSWORD);
  });

  it("saves nothing when the test connection fails, and redacts the password in the error", async () => {
    const { call, store, prisma } = setup("admin", true);
    const result = await call("create", { name: "Sales", connectionString: CONNECTION_STRING });
    expect(result.status).toBe(400);
    expect(result.text).not.toContain(PASSWORD);
    expect(store.put).not.toHaveBeenCalled();
    expect(prisma.databaseConnection.create).not.toHaveBeenCalled();
  });

  it("refuses to grant a connection to an agent outside the space", async () => {
    const { call, connections, prisma } = setup("admin");
    connections.push({ id: "conn-1", spaceId: "space-1", name: "Sales", secretId: "secret-1" });
    const result = await call("setGrants", {
      id: "conn-1",
      createdAt: new Date(0),
      botIds: ["bot-mine-1", "bot-elsewhere"],
    });
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(prisma.botDatabaseGrant.createMany).not.toHaveBeenCalled();
  });

  it("replaces the agents granted a connection", async () => {
    const { call, connections, prisma } = setup("admin");
    connections.push({
      id: "conn-1",
      createdAt: new Date(0),
      spaceId: "space-1",
      name: "Sales",
      host: "h",
      port: 5432,
      database: "d",
      username: "u",
      sslMode: "require",
      testedOk: true,
    });
    const result = await call("setGrants", { id: "conn-1", botIds: ["bot-mine-1"] });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text).json.botIds).toEqual(["bot-mine-1"]);
  });
});
