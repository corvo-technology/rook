import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  countRecentPartnerEvents,
  findEventRoutines,
  lastEventsByType,
  purgeExpiredPartnerEvents,
  recordPartnerEvent,
  settlePartnerEvent,
  summarizePartnerEvents,
} from "./partner-events.js";
import { provisionPartnerTenant } from "./partner-tenants.js";
import { createPartner } from "./partners.js";
import { createRepos } from "./repos.js";
import { asSystem, runAsTenant } from "./row-security.js";

// Needs DATABASE_URL as the runtime login (row security applies to it).
const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("partner events (PostgreSQL, runtime login)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let prisma: PrismaClient;
  let db: PrismaClient;
  let close: () => Promise<void>;
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const partnerIds: string[] = [];

  async function fixture(label: string) {
    const { partner } = await createPartner(db, { slug: `acme-${label}-${suffix}`, name: label });
    partnerIds.push(partner.id);
    const tenant = await provisionPartnerTenant(db, partner, {
      externalTenantId: `shop-${label}`,
      name: label,
    });
    organizationIds.push(tenant.organizationId);
    userIds.push(tenant.ownerUserId);
    const actor = {
      spaceId: tenant.spaceId,
      userId: tenant.ownerUserId,
      email: "owner@partner.invalid",
      isDeploymentOwner: false,
    };
    const bot = await createRepos(db).createBot(actor, {
      name: "Reception",
      title: "",
      description: "",
      instructions: "Help.",
      notifyOnFinish: true,
      computerMode: "team",
      spawnKey: `partner:${partner.id}:reception`,
    });
    const routine = (name: string, eventTrigger: object, active = true) =>
      db.routine.create({
        data: {
          spaceId: tenant.spaceId,
          botId: bot.id,
          userId: tenant.ownerUserId,
          name,
          prompt: `Prompt ${name}`,
          crons: [],
          active,
          eventTrigger,
          templateKey: name,
        },
      });
    return { partner, tenant, bot, routine };
  }
  const row = (partnerId: string, externalTenantId: string, organizationId: string | null) => ({
    partnerId,
    externalTenantId,
    organizationId,
    type: "appointment.no_show",
    name: null,
    status: "accepted" as const,
    error: null,
    payload: { customerName: "Maria" },
    occurredAt: null,
  });

  beforeAll(() => {
    const connection = createDb(databaseUrl!);
    prisma = connection.prisma;
    db = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await connection.pool.end();
    };
  });
  afterAll(async () => {
    await db.partner.deleteMany({ where: { id: { in: partnerIds } } });
    await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await close();
  });

  it("finds only this customer's active routines waiting for the type", async () => {
    const a = await fixture("find-a");
    const b = await fixture("find-b");
    await a.routine("no-show", { type: "appointment.no_show" });
    await a.routine("paused", { type: "appointment.no_show" }, false);
    await a.routine("overdue", { type: "payment.overdue" });
    await a.routine("stock", { type: "custom", name: "stock.low" });
    await b.routine("other-customer", { type: "appointment.no_show" });

    const found = await findEventRoutines(db, a.tenant.organizationId, {
      type: "appointment.no_show",
    });
    expect(found.map((r) => r.name)).toEqual(["no-show"]);
    expect(found[0]?.threadId).toEqual(expect.any(String));
    expect(found[0]?.bot.id).toBe(a.bot.id);

    const custom = await findEventRoutines(db, a.tenant.organizationId, {
      type: "custom",
      name: "stock.low",
    });
    expect(custom.map((r) => r.name)).toEqual(["stock"]);
    expect(
      await findEventRoutines(db, a.tenant.organizationId, { type: "custom", name: "other" }),
    ).toEqual([]);
  });

  it("keeps a template routine once per agent", async () => {
    const a = await fixture("unique");
    await a.routine("once", { type: "appointment.no_show" });
    await expect(a.routine("once", { type: "appointment.no_show" })).rejects.toThrow();
  });

  it("logs events, counts them and lists the latest for the partner only", async () => {
    const a = await fixture("log-a");
    const b = await fixture("log-b");
    const first = await recordPartnerEvent(
      db,
      row(a.partner.id, "shop-log-a", a.tenant.organizationId),
    );
    await recordPartnerEvent(db, {
      ...row(a.partner.id, "shop-log-a", a.tenant.organizationId),
      status: "rejected",
      error: "invalid_event",
      payload: '{"type":"x"}',
    });
    await recordPartnerEvent(db, row(b.partner.id, "shop-log-b", b.tenant.organizationId));
    await settlePartnerEvent(db, first.id, { matched: 2, delivered: 1 });

    const since = new Date(Date.now() - 60_000);
    await expect(countRecentPartnerEvents(db, a.partner.id, "shop-log-a", since)).resolves.toBe(2);
    await expect(countRecentPartnerEvents(db, a.partner.id, "shop-log-b", since)).resolves.toBe(0);

    const summary = await summarizePartnerEvents(db, a.partner.id, new Date());
    expect(summary.recent).toHaveLength(2);
    expect(summary.groups.map((g) => [g.status, g._count._all]).sort()).toEqual([
      ["accepted", 1],
      ["rejected", 1],
    ]);
    const last = await lastEventsByType(db, a.tenant.organizationId);
    expect([...last.keys()]).toEqual(["appointment.no_show:"]);
  });

  it("lets a customer read its own events and nothing else, and write none", async () => {
    const a = await fixture("rls-a");
    const b = await fixture("rls-b");
    await recordPartnerEvent(db, row(a.partner.id, "shop-rls-a", a.tenant.organizationId));
    await recordPartnerEvent(db, row(b.partner.id, "shop-rls-b", b.tenant.organizationId));

    const asA = { spaceId: a.tenant.spaceId, userId: a.tenant.ownerUserId };
    const seen = await runAsTenant(asA, () => prisma.partnerEvent.findMany());
    expect(seen.map((e) => e.organizationId)).toEqual([a.tenant.organizationId]);
    await expect(
      runAsTenant(asA, () =>
        prisma.partnerEvent.create({
          data: {
            ...row(a.partner.id, "shop-rls-a", a.tenant.organizationId),
            payload: {},
            expiresAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runAsTenant(asA, () => prisma.partnerEvent.deleteMany({})).then((r) => r.count),
    ).resolves.toBe(0);
  });

  it("purges events past retention and keeps the rest", async () => {
    const a = await fixture("purge");
    const old = await recordPartnerEvent(
      db,
      row(a.partner.id, "shop-purge", a.tenant.organizationId),
      new Date(Date.now() - 40 * 24 * 60 * 60_000),
    );
    const fresh = await recordPartnerEvent(
      db,
      row(a.partner.id, "shop-purge", a.tenant.organizationId),
    );
    await purgeExpiredPartnerEvents(db);
    const left = await db.partnerEvent.findMany({ where: { partnerId: a.partner.id } });
    expect(left.map((e) => e.id)).toEqual([fresh.id]);
    expect(left.map((e) => e.id)).not.toContain(old.id);
  });
});
