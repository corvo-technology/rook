import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "../router.js";
import { createRouter } from "../router.js";

// Offline boundary: a fake Prisma client drives the real router handlers.

const actorOf = (userId: string): Actor => ({
  spaceId: "space-1",
  userId,
  email: `${userId}@corvo.test`,
  isDeploymentOwner: false,
});

type Row = Record<string, unknown> & { id: string; userId: string; revokedAt: Date | null };

function setup() {
  const rows: Row[] = [];
  const prisma = {
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; spaceId: string } }) =>
        where.spaceId === "space-1" ? { id: "m" } : null,
      ),
    },
    mcpAccessKey: {
      count: async ({ where }: { where: { userId: string } }) =>
        rows.filter((r) => r.userId === where.userId && !r.revokedAt).length,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          id: `key-${rows.length + 1}`,
          createdAt: new Date("2026-02-01T00:00:00Z"),
          lastUsedAt: null,
          revokedAt: null,
        } as Row;
        rows.push(row);
        return { ...row, space: null };
      },
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows.filter((r) => r.userId === where.userId).map((r) => ({ ...r, space: null })),
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; userId: string; revokedAt: null };
        data: Partial<Row>;
      }) => {
        const hits = rows.filter(
          (r) => r.id === where.id && r.userId === where.userId && !r.revokedAt,
        );
        for (const row of hits) Object.assign(row, data);
        return { count: hits.length };
      },
    },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const router = createRouter(deps);
  const as = (userId: string) =>
    createRouterClient(router, { context: { actor: actorOf(userId) } });
  return { as, rows };
}

describe("mcpAccess procedures", () => {
  it("shows the key once, on creation, and never in the list", async () => {
    const { as } = setup();
    const owner = as("user-1");
    const created = await owner.mcpAccess.create({ name: "laptop", level: "talk" });
    expect(created.secret.startsWith("rk_")).toBe(true);
    expect(created.key).toMatchObject({ name: "laptop", level: "talk", spaceId: null });
    const listed = await owner.mcpAccess.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
  });

  it("limits a key only to a space the person belongs to", async () => {
    const { as } = setup();
    await expect(
      as("user-1").mcpAccess.create({ name: "x", level: "read", spaceId: "space-9" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      as("user-1").mcpAccess.create({ name: "x", level: "read", spaceId: "space-1" }),
    ).resolves.toBeDefined();
  });

  it("keeps one person's keys from another's", async () => {
    const { as } = setup();
    const { key } = await as("user-1").mcpAccess.create({ name: "laptop", level: "read" });
    expect(await as("user-2").mcpAccess.list()).toEqual([]);
    await expect(as("user-2").mcpAccess.revoke({ keyId: key.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(as("user-1").mcpAccess.revoke({ keyId: key.id })).resolves.toEqual({ ok: true });
    expect((await as("user-1").mcpAccess.list())[0]?.revokedAt).not.toBeNull();
  });

  it("refuses a level that does not exist", async () => {
    const { as } = setup();
    await expect(
      as("user-1").mcpAccess.create({ name: "x", level: "admin" as never }),
    ).rejects.toBeDefined();
  });
});
