import { MCP_KEY_PREFIX, MCP_KEYS_MAX } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createMcpAccessKey,
  findMcpAccessKey,
  generateMcpAccessSecret,
  hashMcpAccessSecret,
  listMcpAccessKeys,
  McpAccessKeyLimitError,
  McpAccessKeyNotFoundError,
  McpAccessKeySpaceError,
  revokeMcpAccessKey,
  touchMcpAccessKey,
} from "./mcp-access-keys.js";

type Row = {
  id: string;
  userId: string;
  name: string;
  level: string;
  spaceId: string | null;
  secretHash: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** Just enough of the table to show what is stored and what is looked up. */
function fakeDb(members: Array<{ userId: string; spaceId: string }> = []) {
  const rows: Row[] = [];
  const db = {
    spaceMember: {
      findFirst: async ({ where }: { where: { userId: string; spaceId: string } }) =>
        members.find((m) => m.userId === where.userId && m.spaceId === where.spaceId)
          ? { id: "m" }
          : null,
    },
    mcpAccessKey: {
      count: async ({ where }: { where: { userId: string; revokedAt: null } }) =>
        rows.filter((r) => r.userId === where.userId && r.revokedAt === null).length,
      create: async ({
        data,
      }: {
        data: Omit<Row, "id" | "createdAt" | "lastUsedAt" | "revokedAt">;
      }) => {
        const row: Row = {
          ...data,
          id: `key-${rows.length + 1}`,
          createdAt: new Date(2026, 0, rows.length + 1),
          lastUsedAt: null,
          revokedAt: null,
        };
        rows.push(row);
        return { ...row, space: null };
      },
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows.filter((r) => r.userId === where.userId).map((r) => ({ ...r, space: null })),
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null,
      findUnique: async ({ where }: { where: { secretHash: string } }) =>
        rows.find((r) => r.secretHash === where.secretHash) ?? null,
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; userId?: string; revokedAt: null };
          data: Partial<Row>;
        }) => {
          const hits = rows.filter(
            (r) =>
              r.id === where.id &&
              (where.userId === undefined || r.userId === where.userId) &&
              r.revokedAt === null,
          );
          for (const row of hits) Object.assign(row, data);
          return { count: hits.length };
        },
      ),
    },
  };
  return { db: db as never, rows };
}

describe("MCP access key secrets", () => {
  it("makes long random keys that start with the marker", () => {
    const a = generateMcpAccessSecret();
    const b = generateMcpAccessSecret();
    expect(a.startsWith(MCP_KEY_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes to a fixed digest that differs for every secret", () => {
    const digest = hashMcpAccessSecret("rk_example");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashMcpAccessSecret("rk_example")).toBe(digest);
    expect(hashMcpAccessSecret("rk_example2")).not.toBe(digest);
  });
});

describe("creating and verifying keys", () => {
  it("stores only the digest and a short prefix, and returns the secret once", async () => {
    const { db, rows } = fakeDb();
    const { key, secret } = await createMcpAccessKey(db, "user-1", {
      name: "laptop",
      level: "talk",
    });
    expect(secret.startsWith(MCP_KEY_PREFIX)).toBe(true);
    expect(rows[0]?.secretHash).toBe(hashMcpAccessSecret(secret));
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows[0]?.prefix).toBe(secret.slice(0, 7));
    expect(secret.startsWith(key.prefix)).toBe(true);
    expect(JSON.stringify(await listMcpAccessKeys(db, "user-1"))).not.toContain(secret);
  });

  it("finds a live key by its secret and nothing else", async () => {
    const { db } = fakeDb();
    const { secret, key } = await createMcpAccessKey(db, "user-1", {
      name: "laptop",
      level: "read",
    });
    expect(await findMcpAccessKey(db, secret)).toMatchObject({
      id: key.id,
      userId: "user-1",
      level: "read",
      spaceId: null,
    });
    expect(await findMcpAccessKey(db, `${secret}x`)).toBeNull();
    expect(await findMcpAccessKey(db, "not-a-key")).toBeNull();
    expect(await findMcpAccessKey(db, "")).toBeNull();
  });

  it("stops finding a key once it is revoked", async () => {
    const { db } = fakeDb();
    const { secret, key } = await createMcpAccessKey(db, "user-1", {
      name: "laptop",
      level: "read",
    });
    await revokeMcpAccessKey(db, "user-1", key.id);
    expect(await findMcpAccessKey(db, secret)).toBeNull();
    // Revoking again changes nothing and is not an error.
    await expect(revokeMcpAccessKey(db, "user-1", key.id)).resolves.toBeUndefined();
  });

  it("lets nobody revoke another person's key", async () => {
    const { db } = fakeDb();
    const { secret, key } = await createMcpAccessKey(db, "user-1", {
      name: "laptop",
      level: "read",
    });
    await expect(revokeMcpAccessKey(db, "user-2", key.id)).rejects.toBeInstanceOf(
      McpAccessKeyNotFoundError,
    );
    expect(await findMcpAccessKey(db, secret)).not.toBeNull();
  });

  it("limits a key to a space its owner belongs to", async () => {
    const { db } = fakeDb([{ userId: "user-1", spaceId: "space-a" }]);
    const limited = await createMcpAccessKey(db, "user-1", {
      name: "work",
      level: "read",
      spaceId: "space-a",
    });
    expect((await findMcpAccessKey(db, limited.secret))?.spaceId).toBe("space-a");
    await expect(
      createMcpAccessKey(db, "user-1", { name: "other", level: "read", spaceId: "space-b" }),
    ).rejects.toBeInstanceOf(McpAccessKeySpaceError);
  });

  it("caps the keys one person holds", async () => {
    const { db } = fakeDb();
    for (let index = 0; index < MCP_KEYS_MAX; index++)
      await createMcpAccessKey(db, "user-1", { name: `k${index}`, level: "read" });
    await expect(
      createMcpAccessKey(db, "user-1", { name: "one more", level: "read" }),
    ).rejects.toBeInstanceOf(McpAccessKeyLimitError);
    await expect(
      createMcpAccessKey(db, "user-2", { name: "someone else", level: "read" }),
    ).resolves.toBeDefined();
  });
});

describe("last used", () => {
  it("is written at most once a minute", async () => {
    const { db, rows } = fakeDb();
    const { key } = await createMcpAccessKey(db, "user-1", { name: "laptop", level: "read" });
    const t0 = new Date("2026-02-01T00:00:00Z");
    await touchMcpAccessKey(db, { id: key.id, lastUsedAt: null }, t0);
    expect(rows[0]?.lastUsedAt).toEqual(t0);
    const soon = new Date(t0.getTime() + 30_000);
    await touchMcpAccessKey(db, { id: key.id, lastUsedAt: t0 }, soon);
    expect(rows[0]?.lastUsedAt).toEqual(t0);
    const later = new Date(t0.getTime() + 61_000);
    await touchMcpAccessKey(db, { id: key.id, lastUsedAt: t0 }, later);
    expect(rows[0]?.lastUsedAt).toEqual(later);
  });
});
