import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: an in-memory stand-in for the credential tables drives the real router
// handlers, the real role resolution and the real storage rules.

type Row = Record<string, unknown>;

const VALUE = "fake-vault-value-SENTINEL-2";
const owner = { spaceId: "space-1", userId: "user-1", email: "owner@corvo.test" };
const member = { spaceId: "space-1", userId: "user-2", email: "member@corvo.test" };
type Person = typeof owner;
const roles: Record<string, string> = { "user-1": "owner", "user-2": "member" };

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND") return (value as Row[]).every((part) => matches(row, part));
    if (key === "OR") return (value as Row[]).some((part) => matches(row, part));
    if (key === "grants") {
      const grants = (row.grants ?? []) as Row[];
      return grants.some((grant) => matches(grant, (value as { some: Row }).some));
    }
    if (value && typeof value === "object" && "in" in value) {
      return (value.in as unknown[]).includes(row[key]);
    }
    if (value && typeof value === "object" && "notIn" in value) {
      return !(value.notIn as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}

function vaultDeps() {
  const now = new Date("2026-11-01T00:00:00.000Z");
  const bots: Row[] = [
    { id: "bot-1", userId: "user-1", spaceId: "space-1", archivedAt: null },
    { id: "bot-2", userId: "user-2", spaceId: "space-1", archivedAt: null },
    { id: "bot-elsewhere", userId: "user-9", spaceId: "space-9", archivedAt: null },
  ];
  const rows: Row[] = [];
  const uses: Row[] = [];
  const botSecret = {
    findMany: vi.fn(async (args: { where: Row }) =>
      rows.filter((row) => matches(row, args.where)).map((row) => ({ grants: [], ...row })),
    ),
    findFirst: vi.fn(async (args: { where: Row }) => {
      const row = rows.find((entry) => matches(entry, args.where));
      return row ? { grants: [], ...row } : null;
    }),
    count: vi.fn(async (args: { where: Row }) => rows.filter((r) => matches(r, args.where)).length),
    create: vi.fn(async (args: { data: Row }) => {
      rows.push({ grants: [], ...args.data, createdAt: now, updatedAt: now });
      return {};
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Row }) => {
      Object.assign(rows.find((row) => row.id === args.where.id) ?? {}, args.data);
      return {};
    }),
    deleteMany: vi.fn(async (args: { where: Row }) => {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index] ?? {}, args.where)) rows.splice(index, 1);
      }
      return {};
    }),
  };
  const botSecretGrant = {
    findMany: vi.fn(async (args: { where: { secretId: string } }) =>
      ((rows.find((row) => row.id === args.where.secretId)?.grants as Row[]) ?? []).map((g) => ({
        botId: g.botId,
      })),
    ),
    deleteMany: vi.fn(async (args: { where: { secretId: string; botId: { notIn: string[] } } }) => {
      const row = rows.find((entry) => entry.id === args.where.secretId);
      if (row)
        row.grants = ((row.grants as Row[]) ?? []).filter((grant) =>
          args.where.botId.notIn.includes(String(grant.botId)),
        );
      return {};
    }),
    createMany: vi.fn(async (args: { data: Row[] }) => {
      for (const grant of args.data) {
        const row = rows.find((entry) => entry.id === grant.secretId);
        const grants = ((row?.grants as Row[]) ?? []).filter((g) => g.botId !== grant.botId);
        if (row) row.grants = [...grants, { botId: grant.botId }];
      }
      return {};
    }),
  };
  const prisma = {
    spaceMember: {
      findUnique: vi.fn(async (args: { where: { spaceId_userId: { userId: string } } }) => ({
        role: roles[args.where.spaceId_userId.userId] ?? "member",
        roles: [],
      })),
    },
    spaceRole: { findMany: vi.fn(async () => []) },
    bot: {
      findMany: vi.fn(async (args: { where: Row }) => bots.filter((b) => matches(b, args.where))),
    },
    user: {
      findMany: vi.fn(async () => [
        { id: "user-1", name: "Owner" },
        { id: "user-2", name: "Member" },
      ]),
    },
    botSecret,
    botSecretGrant,
    botSecretUse: {
      groupBy: vi.fn(async () => []),
      findMany: vi.fn(async () => uses),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    secret: { count: vi.fn(async () => 0) },
    integrationProviderConfig: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const secrets = {
    put: vi.fn(async (_plaintext: string, _context: unknown, options: { recordId: string }) => ({
      id: options.recordId,
      ref: `enc:${options.recordId}`,
      ciphertext: `enc:${options.recordId}`,
    })),
    load: vi.fn(),
    delete: vi.fn(async () => undefined),
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    secrets,
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
  async function call(
    person: Person,
    path: "list" | "create" | "replace" | "setAgents" | "remove" | "uses",
    input?: unknown,
  ) {
    const actor = { ...person, isDeploymentOwner: false } satisfies Actor;
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/vault/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: input === undefined ? undefined : JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as { json: unknown } };
  }
  return { rows, uses, secrets, call };
}

const create = (extra: Row = {}) => ({
  destination: {
    name: "example_api",
    origin: "https://api.example.test",
    auth: { type: "bearer" },
  },
  value: VALUE,
  ...extra,
});

describe("vault router", () => {
  it("saves a personal credential for the agents named and never returns the value", async () => {
    const { rows, call } = vaultDeps();
    const created = await call(member, "create", create({ botIds: ["bot-2"] }));
    expect(created.status).toBe(200);
    expect(created.body.json).toMatchObject({
      name: "example_api",
      scope: "personal",
      mine: true,
      canManage: true,
      botIds: ["bot-2"],
      lastUsedAt: null,
    });
    expect(created.text).not.toContain(VALUE);
    expect(rows[0]).toMatchObject({ userId: "user-2", scope: "personal", botId: null });
    expect((await call(member, "list")).text).not.toContain(VALUE);
    expect(JSON.stringify(rows)).not.toContain(VALUE);
  });

  it("lets only someone who manages credentials create a team credential", async () => {
    const { rows, secrets, call } = vaultDeps();
    const refused = await call(member, "create", create({ scope: "space" }));
    expect(refused.status).toBe(403);
    expect(rows).toEqual([]);
    expect(secrets.put).not.toHaveBeenCalled();

    const created = await call(owner, "create", create({ scope: "space", botIds: ["bot-1"] }));
    expect(created.status).toBe(200);
    expect(created.body.json).toMatchObject({ scope: "space", canManage: true });
  });

  it("lets a member see a team credential but not change it, its agents or its uses", async () => {
    const { rows, call } = vaultDeps();
    await call(owner, "create", create({ scope: "space", botIds: ["bot-1"] }));
    const id = String(rows[0]?.id);

    const listed = (await call(member, "list")).body.json as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ scope: "space", mine: false, canManage: false });

    expect((await call(member, "setAgents", { id, botIds: ["bot-2"] })).status).toBe(403);
    expect((await call(member, "replace", { id, value: "another-value" })).status).toBe(403);
    expect((await call(member, "remove", { id })).status).toBe(403);
    expect((await call(member, "uses", { id })).status).toBe(403);
    expect(rows).toHaveLength(1);

    const granted = await call(owner, "setAgents", { id, botIds: ["bot-1", "bot-2"] });
    expect(granted.status).toBe(200);
    expect(granted.body.json).toMatchObject({ botIds: expect.arrayContaining(["bot-1", "bot-2"]) });
  });

  it("hides one person's personal credential from everyone else", async () => {
    const { rows, call } = vaultDeps();
    await call(member, "create", create());
    const id = String(rows[0]?.id);

    expect((await call(owner, "list")).body.json).toEqual([]);
    expect((await call(owner, "setAgents", { id, botIds: ["bot-1"] })).status).toBe(404);
    expect((await call(owner, "replace", { id, value: "another-value" })).status).toBe(404);
    expect((await call(owner, "uses", { id })).status).toBe(404);
    // Removing what you cannot see does nothing.
    expect((await call(owner, "remove", { id })).status).toBe(200);
    expect(rows).toHaveLength(1);
  });

  it("grants only agents of this space", async () => {
    const { rows, call } = vaultDeps();
    const refused = await call(member, "create", create({ botIds: ["bot-elsewhere"] }));
    expect(refused.status).toBe(403);
    expect(rows).toEqual([]);

    await call(member, "create", create());
    const id = String(rows[0]?.id);
    expect((await call(member, "setAgents", { id, botIds: ["bot-elsewhere"] })).status).toBe(403);
  });

  it("replaces a value and removes a credential for its owner", async () => {
    const { rows, secrets, call } = vaultDeps();
    await call(member, "create", create());
    const id = String(rows[0]?.id);
    const replaced = await call(member, "replace", { id, value: "replacement-value-9" });
    expect(replaced.status).toBe(200);
    expect(replaced.text).not.toContain("replacement-value-9");
    expect(secrets.put).toHaveBeenCalledTimes(2);

    expect((await call(member, "remove", { id })).status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("lists recent uses to the person who manages the credential, with no value", async () => {
    const { rows, uses, call } = vaultDeps();
    await call(member, "create", create({ botIds: ["bot-2"] }));
    const id = String(rows[0]?.id);
    uses.push({
      id: "use-1",
      botId: "bot-2",
      runId: "run-1",
      forUserId: "user-2",
      destination: "https://api.example.test",
      outcome: "ok",
      createdAt: new Date("2026-11-02T00:00:00.000Z"),
    });
    const result = await call(member, "uses", { id });
    expect(result.status).toBe(200);
    expect(result.body.json).toEqual([
      {
        id: "use-1",
        botId: "bot-2",
        runId: "run-1",
        forName: "Member",
        forMe: true,
        destination: "https://api.example.test",
        outcome: "ok",
        createdAt: "2026-11-02T00:00:00.000Z",
      },
    ]);
    expect(result.text).not.toContain(VALUE);
  });
});
