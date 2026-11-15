import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  asSystem,
  drainUnscopedDatabaseAccess,
  runAsSystem,
  runAsSystemInTransaction,
  runAsTenant,
} from "./row-security.js";
import { createPooledDb, createTransactionPooler } from "./transaction-pooler.test-support.js";

const runtimeUrl = process.env.DATABASE_URL;
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && runtimeUrl && migrationUrl && runtimeUrl !== migrationUrl
    ? describe.sequential
    : describe.skip;

describePostgres("row-level security behind a transaction-mode pooler", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `pool-org-${suffix}`;
  const tenants = ["a", "b", "c"].map((name) => ({
    name,
    userId: `pool-user-${name}-${suffix}`,
    spaceId: `pool-space-${name}-${suffix}`,
    botId: `pool-bot-${name}-${suffix}`,
  }));
  const [a, b] = tenants as [(typeof tenants)[0], (typeof tenants)[0]];
  let owner: ReturnType<typeof createDb>;
  const pooler = createTransactionPooler(runtimeUrl ?? "");
  let db: PrismaClient;

  beforeAll(async () => {
    owner = createDb(migrationUrl!);
    const o = asSystem(owner.prisma);
    await pooler.open();
    const pool = pooler.createPool();
    db = createPooledDb(pool);
    await o.organization.create({
      data: { id: organizationId, name: "Pool", slug: organizationId, createdAt: new Date() },
    });
    for (const t of tenants) {
      await o.user.create({
        data: { id: t.userId, name: t.name, email: `${t.userId}@corvo.test`, emailVerified: true },
      });
      await o.space.create({ data: { id: t.spaceId, organizationId, name: t.name } });
      await o.bot.create({
        data: { id: t.botId, spaceId: t.spaceId, userId: t.userId, name: t.name, color: "#000" },
      });
    }
  });

  afterAll(async () => {
    if (!owner) return;
    const o = asSystem(owner.prisma);
    await o.organization.deleteMany({ where: { id: organizationId } });
    await o.user.deleteMany({ where: { id: { in: tenants.map((t) => t.userId) } } });
    await db?.$disconnect();
    await pooler.close();
    await owner.prisma.$disconnect();
    await owner.pool.end();
  });

  const ids = () => tenants.map((t) => t.botId);
  const botsSeenBy = (tenant: (typeof tenants)[0]) =>
    runAsTenant(tenant, () =>
      db.bot.findMany({ where: { id: { in: ids() } }, select: { id: true } }),
    ).then((rows) => rows.map((row) => row.id));

  it("shows each tenant its own rows when consecutive calls alternate tenants", async () => {
    const wrong: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      for (const t of [a, b, a, tenants[2]!, b]) {
        const seen = await botsSeenBy(t);
        if (seen.length !== 1 || seen[0] !== t.botId) wrong.push(`${t.name}:${seen.join("|")}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the context inside interactive transactions", async () => {
    const wrong: string[] = [];
    for (let round = 0; round < 8; round += 1) {
      for (const t of [a, b]) {
        const seen = await runAsTenant(t, () =>
          db.$transaction(async (tx) => {
            const first = await tx.bot.findMany({ where: { id: { in: ids() } } });
            const second = await tx.bot.findMany({ where: { id: { in: ids() } } });
            return [...first, ...second].map((row) => row.id);
          }),
        );
        if (seen.some((id) => id !== t.botId) || seen.length !== 2) wrong.push(t.name);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("keeps interleaved tenants apart", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const t = tenants[i % 3]!;
        return botsSeenBy(t).then((seen) => ({ t, seen }));
      }),
    );
    for (const { t, seen } of results) expect(seen).toEqual([t.botId]);
  });

  it("leaves no tenant or bypass state on any server connection", async () => {
    await botsSeenBy(a);
    await runAsSystem("pooler test", () => db.bot.count({ where: { id: { in: ids() } } }));
    await runAsTenant(b, () => db.$transaction(async (tx) => tx.bot.count()));
    for (const settings of await pooler.serverSettings()) {
      expect(settings.space_id ?? "").toBe("");
      expect(settings.user_id ?? "").toBe("");
      expect(settings.bypass ?? "").not.toBe("on");
    }
  });

  it("applies the system bypass only inside the call that asked for it", async () => {
    const all = await runAsSystem("pooler test", () =>
      db.bot.findMany({ where: { id: { in: ids() } } }),
    );
    expect(all).toHaveLength(3);
    for (let i = 0; i < 6; i += 1) {
      expect(await db.bot.findMany({ where: { id: { in: ids() } } })).toEqual([]);
      expect(await botsSeenBy(b)).toEqual([b.botId]);
    }
    drainUnscopedDatabaseAccess();
  });

  it("returns nothing without a context", async () => {
    await runAsSystem("pooler test", () => db.bot.count());
    for (let i = 0; i < 6; i += 1) {
      expect(await db.bot.findMany({ where: { id: { in: ids() } } })).toEqual([]);
    }
    expect(drainUnscopedDatabaseAccess().length).toBeGreaterThan(0);
  });

  it("writes security events as the system and refuses them to a tenant", async () => {
    const id = `pool-security-event-${suffix}`;
    for (let i = 0; i < 6; i += 1) {
      await runAsTenant(a, () => db.bot.count());
      await runAsSystem(
        "pooler test",
        () =>
          db.$executeRaw`INSERT INTO security_events (id, type) VALUES (${`${id}-${i}`}, 'pool.test')`,
      );
    }
    const written = await runAsSystem("pooler test", () =>
      db.securityEvent.count({ where: { id: { startsWith: id } } }),
    );
    expect(written).toBe(6);
    await expect(
      runAsTenant(a, () => db.securityEvent.create({ data: { type: "pool.test" } })),
    ).rejects.toThrow(/row-level security/);
    await runAsSystem(
      "pooler test",
      () => db.$executeRaw`DELETE FROM security_events WHERE id LIKE ${`${id}%`}`,
    );
  });

  it("runs a system step inside a tenant transaction and returns to the tenant", async () => {
    const result = await runAsTenant(a, () =>
      db.$transaction(async (tx) => {
        const system = await runAsSystemInTransaction(tx, "pooler test", () =>
          tx.bot.count({ where: { id: { in: ids() } } }),
        );
        const tenant = await tx.bot.count({ where: { id: { in: ids() } } });
        return { system, tenant };
      }),
    );
    expect(result).toEqual({ system: 3, tenant: 1 });
  });
});
