import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { grantPartnerAllowance } from "./partner-allowance.js";
import { consumePartnerEntryCode } from "./partner-entry.js";
import {
  findPartnerTenant,
  provisionPartnerTenant,
  setPartnerTenantState,
} from "./partner-tenants.js";
import { giveWallet } from "./partner-wallet.test-support.js";
import { authenticatePartner, createPartner } from "./partners.js";
import { createRepos } from "./repos.js";
import { runAsSystem, runAsTenant } from "./row-security.js";
import { IsolationError } from "./scope.js";

// Needs DATABASE_URL as the runtime login (row security applies to it).
const runtimeUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && runtimeUrl ? describe.sequential : describe.skip;

type Tenant = {
  partnerKey: "a" | "b";
  externalTenantId: string;
  organizationId: string;
  spaceId: string;
  userId: string;
  botId: string;
};

describePostgres("partner isolation (PostgreSQL, runtime login)", () => {
  const stamp = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  const partners: Record<"a" | "b", { id: string; slug: string; key: string }> = {} as never;
  const tenants: Tenant[] = [];
  const walletOwners: Array<{ userId: string; organizationId: string }> = [];

  const system = <T>(fn: () => Promise<T>) => runAsSystem("partner isolation test", fn);
  const asTenant = <T>(t: Tenant, fn: () => Promise<T>) =>
    runAsTenant({ spaceId: t.spaceId, userId: t.userId }, fn);
  const actorOf = (t: Tenant) => ({
    spaceId: t.spaceId,
    userId: t.userId,
    email: "owner@partner.invalid",
    isDeploymentOwner: false,
  });

  beforeAll(async () => {
    const connection = createDb(runtimeUrl!);
    prisma = connection.prisma;
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
    for (const key of ["a", "b"] as const) {
      const made = await system(() =>
        createPartner(prisma, { slug: `iso-${key}-${stamp}`, name: `Partner ${key}` }),
      );
      partners[key] = { id: made.partner.id, slug: made.partner.slug, key: made.key };
      walletOwners.push(
        await system(() => giveWallet(prisma, made.partner.id, `iso-${key}-${stamp}`, 100_000)),
      );
    }
    // Two customers of partner A and one of partner B.
    for (const [partnerKey, externalTenantId] of [
      ["a", "one"],
      ["a", "two"],
      ["b", "three"],
    ] as const) {
      const result = await system(() =>
        provisionPartnerTenant(prisma, partners[partnerKey], {
          externalTenantId,
          name: `Customer ${externalTenantId}`,
        }),
      );
      const tenant: Tenant = {
        partnerKey,
        externalTenantId,
        organizationId: result.organizationId,
        spaceId: result.spaceId,
        userId: result.ownerUserId,
        botId: "",
      };
      // The owner makes a bot, then a connector, a secret and a routine, through the same
      // repositories and context a request would use.
      await asTenant(tenant, async () => {
        const bot = await createRepos(prisma).createBot(actorOf(tenant), {
          name: `Bot ${externalTenantId}`,
          title: "",
          description: "",
          instructions: `Private instructions of ${externalTenantId}`,
          notifyOnFinish: true,
          computerMode: "team",
          spawnKey: `iso-${externalTenantId}`,
        });
        tenant.botId = bot.id;
        await prisma.secret.create({
          data: {
            id: `secret-${externalTenantId}-${stamp}`,
            userId: tenant.userId,
            spaceId: tenant.spaceId,
            kind: "mcp",
            ciphertext: `sealed-token-of-${externalTenantId}`,
          },
        });
        await prisma.mcpServer.create({
          data: {
            spaceId: tenant.spaceId,
            userId: tenant.userId,
            slug: "partner-system",
            name: "Partner system",
            description: "",
            transport: "streamable_http",
            endpoint: "https://mcp.partner.example/v1",
            headers: { Authorization: true },
            secretId: `secret-${externalTenantId}-${stamp}`,
          },
        });
        await prisma.routine.create({
          data: {
            spaceId: tenant.spaceId,
            botId: bot.id,
            userId: tenant.userId,
            name: `Routine ${externalTenantId}`,
            prompt: "Do the thing",
            crons: [],
          },
        });
      });
      await system(() =>
        grantPartnerAllowance(
          prisma,
          {
            organizationId: tenant.organizationId,
            partnerId: partners[partnerKey].id,
            externalTenantId,
          },
          { amountCents: 500, period: "2099-06" },
        ),
      );
      tenants.push(tenant);
    }
  });

  afterAll(async () => {
    await system(async () => {
      await prisma.partner.deleteMany({
        where: { id: { in: Object.values(partners).map((p) => p.id) } },
      });
      await prisma.organization.deleteMany({
        where: {
          id: {
            in: [...tenants, ...walletOwners].map((t) => t.organizationId),
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [...tenants.map((t) => t.userId), ...walletOwners.map((w) => w.userId)] },
        },
      });
    });
    await close();
  });

  const others = (t: Tenant) => tenants.filter((o) => o !== t);

  it("shows each customer's owner only that customer's bots, memory, connectors, secrets and routines", async () => {
    for (const t of tenants) {
      const seen = await asTenant(t, async () => ({
        bots: await prisma.bot.findMany(),
        threads: await prisma.thread.findMany(),
        memory: await prisma.memoryDocument.findMany(),
        servers: await prisma.mcpServer.findMany(),
        secrets: await prisma.secret.findMany(),
        routines: await prisma.routine.findMany(),
      }));
      expect(seen.bots.map((r) => r.id)).toEqual([t.botId]);
      for (const [name, rows] of Object.entries({
        threads: seen.threads,
        memory: seen.memory,
        servers: seen.servers,
        secrets: seen.secrets,
        routines: seen.routines,
      })) {
        expect(rows.length, name).toBeGreaterThan(0);
        for (const row of rows) expect((row as { spaceId: string }).spaceId, name).toBe(t.spaceId);
      }
    }
  });

  it("shows each customer's owner only its own organization's credit, while server code still sees all", async () => {
    for (const t of tenants) {
      const seen = await asTenant(t, async () => ({
        entries: await prisma.modelCreditEntry.findMany(),
        lots: await prisma.modelCreditLot.findMany(),
        accounts: await prisma.modelCreditAccount.findMany(),
      }));
      expect(seen.entries.length).toBeGreaterThan(0);
      for (const row of [...seen.entries, ...seen.lots, ...seen.accounts]) {
        expect(row.organizationId).toBe(t.organizationId);
      }
      expect(seen.accounts).toHaveLength(1);
      const changed = await asTenant(t, () =>
        prisma.modelCreditAccount.updateMany({
          where: { organizationId: { in: others(t).map((o) => o.organizationId) } },
          data: { balanceMicros: 0n },
        }),
      );
      expect(changed).toEqual({ count: 0 });
    }
    const all = await system(() =>
      prisma.modelCreditAccount.count({
        where: { organizationId: { in: tenants.map((t) => t.organizationId) } },
      }),
    );
    expect(all).toBe(tenants.length);
  });

  it("does not let one customer's owner fetch, change or delete another's rows by id", async () => {
    for (const t of tenants) {
      for (const other of others(t)) {
        await asTenant(t, async () => {
          await expect(prisma.bot.findUnique({ where: { id: other.botId } })).resolves.toBeNull();
          await expect(createRepos(prisma).getBot(actorOf(t), other.botId)).rejects.toThrow(
            IsolationError,
          );
          const secretId = `secret-${other.externalTenantId}-${stamp}`;
          await expect(prisma.secret.findUnique({ where: { id: secretId } })).resolves.toBeNull();
          await expect(
            prisma.bot.updateMany({ where: { id: other.botId }, data: { name: "taken over" } }),
          ).resolves.toEqual({ count: 0 });
          await expect(prisma.secret.deleteMany({ where: { id: secretId } })).resolves.toEqual({
            count: 0,
          });
        });
      }
    }
    const intact = await system(() =>
      prisma.bot.findMany({ where: { id: { in: tenants.map((t) => t.botId) } } }),
    );
    expect(intact.map((b) => b.name).sort()).toEqual(
      tenants.map((t) => `Bot ${t.externalTenantId}`).sort(),
    );
  });

  it("keeps partner keys, customers and entry codes out of every customer's reach", async () => {
    for (const t of tenants) {
      await asTenant(t, async () => {
        await expect(prisma.partner.findMany()).resolves.toEqual([]);
        await expect(prisma.partnerTenant.findMany()).resolves.toEqual([]);
        await expect(prisma.partnerEntryCode.findMany()).resolves.toEqual([]);
      });
    }
  });

  it("stops a partner's key at its own customers", async () => {
    const [one, two, three] = tenants as [Tenant, Tenant, Tenant];
    await system(async () => {
      const a = await authenticatePartner(prisma, partners.a.key);
      const b = await authenticatePartner(prisma, partners.b.key);
      expect(a?.id).toBe(partners.a.id);
      expect(b?.id).toBe(partners.b.id);
      // A cannot find, suspend or resume B's customer, and B cannot touch A's.
      await expect(
        findPartnerTenant(prisma, partners.a.id, three.externalTenantId),
      ).resolves.toBeNull();
      await expect(
        setPartnerTenantState(prisma, partners.a.id, three.externalTenantId, "suspended"),
      ).resolves.toBe(false);
      await expect(
        findPartnerTenant(prisma, partners.b.id, one.externalTenantId),
      ).resolves.toBeNull();
      await expect(
        setPartnerTenantState(prisma, partners.b.id, two.externalTenantId, "suspended"),
      ).resolves.toBe(false);
      // A's own customer is reachable by A.
      await expect(
        findPartnerTenant(prisma, partners.a.id, one.externalTenantId),
      ).resolves.toMatchObject({
        organizationId: one.organizationId,
      });
    });
    const states = await system(() =>
      prisma.partnerTenant.findMany({
        where: { organizationId: { in: tenants.map((t) => t.organizationId) } },
      }),
    );
    expect(states.every((s) => s.state === "enabled")).toBe(true);
  });

  it("opens a customer's own owner with its code and never another's", async () => {
    const [one, , three] = tenants as [Tenant, Tenant, Tenant];
    for (const t of [one, three]) {
      const row = await system(() =>
        findPartnerTenant(prisma, partners[t.partnerKey].id, t.externalTenantId),
      );
      const code = `iso-code-${t.externalTenantId}-${stamp}`;
      const codeHash = createHash("sha256").update(code).digest("hex");
      await system(() =>
        prisma.partnerEntryCode.create({
          data: {
            codeHash,
            partnerId: partners[t.partnerKey].id,
            tenantId: row!.id,
            externalUserId: "u",
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      );
      const consumed = await system(() => consumePartnerEntryCode(prisma, codeHash));
      expect(consumed).toMatchObject({ userId: t.userId });
    }
  });

  it("leaves the other customers whole when one customer is removed", async () => {
    const [one, two, three] = tenants as [Tenant, Tenant, Tenant];
    await system(() => prisma.organization.deleteMany({ where: { id: one.organizationId } }));
    const survivors = await system(async () => ({
      bots: await prisma.bot.findMany({ where: { id: { in: [two.botId, three.botId] } } }),
      servers: await prisma.mcpServer.count({
        where: { spaceId: { in: [two.spaceId, three.spaceId] } },
      }),
      routines: await prisma.routine.count({
        where: { spaceId: { in: [two.spaceId, three.spaceId] } },
      }),
      credit: await prisma.modelCreditEntry.count({
        where: { organizationId: { in: [two.organizationId, three.organizationId] } },
      }),
      gone: await prisma.bot.count({ where: { id: one.botId } }),
    }));
    expect(survivors.bots).toHaveLength(2);
    expect(survivors.servers).toBe(2);
    expect(survivors.routines).toBe(2);
    expect(survivors.credit).toBeGreaterThanOrEqual(2);
    expect(survivors.gone).toBe(0);
    await asTenant(two, async () => {
      await expect(prisma.bot.findMany()).resolves.toHaveLength(1);
    });
  });
});
