import { randomUUID } from "node:crypto";
import type { PlanConfig } from "@corvo/contracts";
import { planConfigFromEnv } from "@corvo/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import {
  ComputerLimitError,
  ensureComputerRecord,
  organizationComputerCount,
  restoreBotUnderComputerQuota,
} from "./computers.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { organizationEntitlements, setOrganizationOverride, spaceComputerSize } from "./plans.js";
import { asSystem, runAsSystem } from "./row-security.js";
import { organizationSeats, SeatLimitError } from "./seats.js";
import {
  claimStorageAlert,
  forgetStoredObjects,
  notifyStorageNearLimit,
  organizationIdForObjectKey,
  reconcileStorageUsage,
  recordStoredObject,
  storageUsedBytes,
} from "./storage-usage.js";
import { acceptInvitation, createInvitations } from "./team.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const PLANS = JSON.stringify({ price_team: "team", price_company: "company" });

describePostgres("plan entitlements (PostgreSQL)", () => {
  const stamp = String(Date.now()).slice(-7);
  const address = `+1558${stamp}`;
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let owner: { userId: string; spaceId: string };
  let plans: PlanConfig;
  let computers = 0;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma, "plan entitlements fixture");
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    owner = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "sendblue", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    plans = planConfigFromEnv({ PLAN_PRICES: PLANS })!;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (owner) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.bot.deleteMany({ where: { spaceId: owner.spaceId } });
      await system.organization.deleteMany({ where: { id: owner.spaceId } });
      await system.user.deleteMany({ where: { id: owner.userId } });
    }
    await close?.();
  });

  const subscribe = (priceId: string | null, status: string | null) =>
    system.billingAccount.upsert({
      where: { organizationId: owner.spaceId },
      create: {
        organizationId: owner.spaceId,
        customerId: `cus_${randomUUID()}`,
        priceId,
        status,
      },
      update: { priceId, status },
    });

  it("resolves the plan from the stored price, and personal without a paid mapped one", async () => {
    const plan = () => organizationEntitlements(system, plans, owner.spaceId);
    expect((await plan())?.plan).toBe("personal");
    await subscribe("price_team", "trialing");
    expect((await plan())?.plan).toBe("personal");
    await subscribe("price_team", "active");
    expect(await plan()).toMatchObject({ plan: "team", computerSize: "medium", computers: 1 });
    await subscribe("price_unknown", "active");
    expect((await plan())?.plan).toBe("personal");
    await subscribe("price_company", "past_due");
    expect(await spaceComputerSize(system, plans, owner.spaceId)).toBe("large");
    // Self-hosted: no plans configured, no limits and no size.
    expect(await organizationEntitlements(system, undefined, owner.spaceId)).toBeNull();
    expect(await spaceComputerSize(system, undefined, owner.spaceId)).toBeUndefined();
  });

  it("counts bytes on put and delete, replaces on a repeated put, and never goes below zero", async () => {
    const key = `artifacts/${owner.spaceId}/${randomUUID()}`;
    const other = `artifacts/${owner.spaceId}/${randomUUID()}`;
    expect(await organizationIdForObjectKey(system, key)).toBe(owner.spaceId);
    expect(await organizationIdForObjectKey(system, "somewhere/else")).toBeNull();
    const before = await storageUsedBytes(system, owner.spaceId);
    expect(
      await recordStoredObject(system, { key, organizationId: owner.spaceId, bytes: 100 }),
    ).toBe(before + 100);
    await recordStoredObject(system, { key: other, organizationId: owner.spaceId, bytes: 50 });
    // The same key again is a replacement, not more bytes.
    await recordStoredObject(system, { key, organizationId: owner.spaceId, bytes: 30 });
    expect(await storageUsedBytes(system, owner.spaceId)).toBe(before + 80);
    await forgetStoredObjects(system, [key, "never-recorded"]);
    expect(await storageUsedBytes(system, owner.spaceId)).toBe(before + 50);
    await forgetStoredObjects(system, [other]);
    expect(await storageUsedBytes(system, owner.spaceId)).toBe(before);
  });

  it("claims the 80% alert once per period and puts one coded entry in the owner's inbox", async () => {
    await system.storageUsage.upsert({
      where: { organizationId: owner.spaceId },
      create: { organizationId: owner.spaceId },
      update: { alertedPeriod: null },
    });
    expect(await claimStorageAlert(system, owner.spaceId, "2026-11")).toBe(true);
    expect(await claimStorageAlert(system, owner.spaceId, "2026-11")).toBe(false);
    expect(await claimStorageAlert(system, owner.spaceId, "2026-12")).toBe(true);

    const input = { usedBytes: 85, limitBytes: 100, period: "2026-11" };
    await notifyStorageNearLimit(system, owner.spaceId, input);
    await notifyStorageNearLimit(system, owner.spaceId, { ...input, usedBytes: 90 });
    const rows = await system.notification.findMany({
      where: { userId: owner.userId, code: "storage_near_limit" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "alert", params: { percent: "90" } });
  });

  it("rebuilds the counter from the bucket and keeps objects recorded moments ago", async () => {
    const listed = `artifacts/${owner.spaceId}/${randomUUID()}`;
    const stale = `artifacts/${owner.spaceId}/${randomUUID()}`;
    const fresh = `artifacts/${owner.spaceId}/${randomUUID()}`;
    await recordStoredObject(system, { key: stale, organizationId: owner.spaceId, bytes: 999 });
    await recordStoredObject(system, { key: fresh, organizationId: owner.spaceId, bytes: 7 });
    await system.storageObject.update({
      where: { key: stale },
      data: { recordedAt: new Date(Date.now() - 3_600_000) },
    });
    await system.storageObject.deleteMany({
      where: { organizationId: owner.spaceId, key: { notIn: [stale, fresh] } },
    });
    // Drift: the counter disagrees with the ledger.
    await system.storageUsage.update({
      where: { organizationId: owner.spaceId },
      data: { bytes: 123_456 },
    });

    async function* bucket() {
      yield { key: listed, size: 1000, lastModified: new Date() };
      yield { key: `artifacts/missing-space/${randomUUID()}`, size: 5, lastModified: new Date() };
    }
    const changed = await reconcileStorageUsage(system, bucket());
    expect(changed).toContain(owner.spaceId);
    // The listed object counts, the old unlisted one is gone, the just-recorded one stays.
    expect(await storageUsedBytes(system, owner.spaceId)).toBe(1000 + 7);
    expect(await system.storageObject.findUnique({ where: { key: stale } })).toBeNull();
    expect(await system.storageObject.findUnique({ where: { key: fresh } })).not.toBeNull();
    await forgetStoredObjects(system, [listed, fresh]);
  });

  describe("computers per plan", () => {
    async function liveComputer(userId = owner.userId) {
      computers += 1;
      const computer = await system.computer.create({
        data: {
          spaceId: owner.spaceId,
          userId,
          scope: "dedicated",
          scopeKey: `plan-${stamp}-${computers}`,
          homeKey: `plan-home-${stamp}-${computers}`,
          kind: "fake",
        },
      });
      const bot = await system.bot.create({
        data: {
          spaceId: owner.spaceId,
          userId,
          name: `Plan bot ${computers}`,
          color: "#000000",
          computerId: computer.id,
        },
      });
      return { computer, bot };
    }
    beforeEach(async () => {
      await system.bot.deleteMany({ where: { spaceId: owner.spaceId } });
      await system.computer.deleteMany({ where: { spaceId: owner.spaceId } });
    });
    const create = (botId: string) =>
      ensureComputerRecord(system, {
        mode: "dedicated",
        spaceId: owner.spaceId,
        userId: owner.userId,
        botId,
        kind: "fake",
      });

    it("refuses a computer past the plan with a coded error, and keeps the existing ones", async () => {
      vi.stubEnv("PLAN_PRICES", PLANS);
      await subscribe(null, null);
      const first = await liveComputer();
      expect(await organizationComputerCount(system, owner.spaceId)).toBe(1);
      // Personal allows one computer.
      const refused = await create("bot-over-limit").catch((error) => error);
      expect(refused).toBeInstanceOf(ComputerLimitError);
      expect(refused).toMatchObject({ limit: 1, plan: "personal" });
      expect(await system.computer.findUnique({ where: { id: first.computer.id } })).not.toBeNull();

      // Upgrading lifts the cap; a downgrade keeps what exists but refuses another.
      await subscribe("price_team", "active");
      await liveComputer();
      await liveComputer();
      expect(await organizationComputerCount(system, owner.spaceId)).toBe(3);
      await expect(create("bot-over-team")).rejects.toMatchObject({ limit: 3, plan: "team" });
      await subscribe(null, "canceled");
      expect(await organizationComputerCount(system, owner.spaceId)).toBe(3);
      await expect(create("bot-after-downgrade")).rejects.toBeInstanceOf(ComputerLimitError);
    });

    it("lets the plan win over the per-user variable, which stays the cap without plans", async () => {
      vi.stubEnv("SANDBOX_MAX_COMPUTERS_PER_USER", "1");
      vi.stubEnv("PLAN_PRICES", PLANS);
      await subscribe("price_company", "active");
      await liveComputer();
      await liveComputer();
      // Two computers exist; the per-user cap of 1 is not consulted under plans.
      const added = await create("bot-plan-wins");
      expect(added.scopeKey).toBe("bot:bot-plan-wins");

      vi.stubEnv("PLAN_PRICES", "");
      const error = await create("bot-env-cap").catch((reason) => reason);
      expect(error).toBeInstanceOf(ComputerLimitError);
      expect(error.plan).toBeUndefined();
    });

    it("refuses restoring an archived bot past the plan", async () => {
      vi.stubEnv("PLAN_PRICES", PLANS);
      await subscribe(null, null);
      await liveComputer();
      const archived = await liveComputer();
      await system.bot.update({ where: { id: archived.bot.id }, data: { archivedAt: new Date() } });
      await expect(
        restoreBotUnderComputerQuota(system, {
          userId: owner.userId,
          botId: archived.bot.id,
          computerId: archived.computer.id,
        }),
      ).rejects.toMatchObject({ plan: "personal" });
    });
  });

  describe("seats", () => {
    const LIMITS = JSON.stringify({ team: { seatsIncluded: 2, maxSeats: 3 } });
    let second: string;
    const people: string[] = [];

    beforeAll(async () => {
      second = `plan-seats-space-${stamp}`;
      await system.space.create({
        data: { id: second, organizationId: owner.spaceId, name: "Second" },
      });
      await system.spaceMember.create({
        data: {
          id: `plan-seats-owner-${stamp}`,
          spaceId: second,
          organizationId: owner.spaceId,
          userId: owner.userId,
          role: "owner",
          createdAt: new Date(),
        },
      });
    });

    afterAll(async () => {
      await system.user.deleteMany({ where: { id: { in: people } } });
    });

    beforeEach(async () => {
      await system.spaceInvitation.deleteMany({
        where: { space: { organizationId: owner.spaceId } },
      });
      // Everyone but the owner leaves between tests.
      await system.member.deleteMany({
        where: { organizationId: owner.spaceId, userId: { not: owner.userId } },
      });
      vi.stubEnv("PLAN_PRICES", PLANS);
      vi.stubEnv("PLAN_LIMITS", LIMITS);
      await subscribe("price_team", "active");
      await system.organizationLimitOverride.deleteMany({
        where: { organizationId: owner.spaceId },
      });
    });

    const invite = (addresses: string[], spaceId = owner.spaceId) =>
      createInvitations(system, {
        spaceId,
        actorId: owner.userId,
        role: "member",
        addresses,
      });

    async function joiner(email: string) {
      const id = `plan-seat-user-${stamp}-${people.length}`;
      people.push(id);
      await system.user.create({ data: { id, name: email, email, emailVerified: true } });
      return { id, email, emailVerified: true };
    }

    async function addMember(email: string) {
      const user = await joiner(email);
      await system.member.create({
        data: {
          id: `plan-seat-member-${user.id}`,
          organizationId: owner.spaceId,
          userId: user.id,
          role: "member",
          createdAt: new Date(),
        },
      });
      return user;
    }

    it("counts members and pending invites once each, across spaces, never agents or expired invites", async () => {
      const member = await addMember(`member-${stamp}@corvo.test`);
      await invite([`a-${stamp}@corvo.test`], owner.spaceId);
      // The same person invited to a second space holds one seat.
      await invite([`a-${stamp}@corvo.test`], second);
      // A member invited to another space holds none beyond theirs.
      await invite([member.email], second);
      await system.spaceInvitation.create({
        data: {
          id: `expired-${stamp}`,
          spaceId: owner.spaceId,
          email: `old-${stamp}@corvo.test`,
          expiresAt: new Date(Date.now() - 1000),
          inviterId: owner.userId,
        },
      });
      const seats = await organizationSeats(system, owner.spaceId);
      expect(seats.members).toBe(2);
      expect(seats.invited).toBe(1);
      expect(seats.total).toBe(3);
      expect(seats.people.size).toBe(3);
      expect(seats.people.has(member.email)).toBe(true);
      expect(seats.people.has(`a-${stamp}@corvo.test`)).toBe(true);
    });

    it("invites up to the plan's maximum and refuses beyond it with a coded error", async () => {
      // The owner holds one of the three seats.
      await invite([`one-${stamp}@corvo.test`]);
      await invite([`two-${stamp}@corvo.test`]);
      const refused = await invite([`three-${stamp}@corvo.test`]).catch((error) => error);
      expect(refused).toBeInstanceOf(SeatLimitError);
      expect(refused).toMatchObject({ code: "PLAN_SEAT_LIMIT", maxSeats: 3, plan: "team" });
      // Inviting someone who already holds a seat adds nothing, so it is allowed at the maximum.
      await expect(invite([`two-${stamp}@corvo.test`], second)).resolves.toBeTruthy();
      expect((await organizationSeats(system, owner.spaceId)).total).toBe(3);
    });

    it("refuses every invite on Personal, which is just one person", async () => {
      await subscribe(null, null);
      const refused = await invite([`solo-${stamp}@corvo.test`]).catch((error) => error);
      expect(refused).toBeInstanceOf(SeatLimitError);
      expect(refused).toMatchObject({ maxSeats: 1, plan: "personal" });
    });

    it("never removes members on a downgrade, and blocks new people until the count fits", async () => {
      const pending = `pending-${stamp}@corvo.test`;
      const first = await addMember(`first-${stamp}@corvo.test`);
      await addMember(`second-${stamp}@corvo.test`);
      await invite([pending]).catch(() => undefined);
      await system.spaceInvitation.deleteMany({ where: { email: pending } });
      await system.spaceInvitation.create({
        data: {
          id: `kept-${stamp}`,
          spaceId: owner.spaceId,
          email: pending,
          expiresAt: new Date(Date.now() + 86_400_000),
          inviterId: owner.userId,
        },
      });
      expect((await organizationSeats(system, owner.spaceId)).members).toBe(3);

      await subscribe("price_team", "canceled");
      // Everyone is still here and counted; the plan now allows one.
      expect(await system.member.count({ where: { organizationId: owner.spaceId } })).toBe(3);
      await expect(invite([`new-${stamp}@corvo.test`])).rejects.toBeInstanceOf(SeatLimitError);
      // A pending invitation cannot add a person either, but nobody is removed for it.
      const invited = await joiner(pending);
      await expect(
        acceptInvitation(system, { id: `kept-${stamp}`, user: invited }),
      ).rejects.toBeInstanceOf(SeatLimitError);
      expect(await system.member.count({ where: { organizationId: owner.spaceId } })).toBe(3);
      expect(await system.member.findFirst({ where: { userId: first.id } })).not.toBeNull();
    });

    it("lets an accepted invitation take the seat it already holds", async () => {
      const email = `joins-${stamp}@corvo.test`;
      const [row] = (await invite([email])).invitations;
      const user = await joiner(email);
      const joined = await acceptInvitation(system, { id: row!.id, user });
      expect(joined).toMatchObject({ organizationId: owner.spaceId });
      const seats = await organizationSeats(system, owner.spaceId);
      expect(seats).toMatchObject({ members: 2, invited: 0, total: 2 });
    });

    it("applies a platform override over the plan, and the plan again once it is cleared", async () => {
      await subscribe(null, null);
      await expect(invite([`o1-${stamp}@corvo.test`])).rejects.toBeInstanceOf(SeatLimitError);
      await setOrganizationOverride(system, {
        organizationId: owner.spaceId,
        override: { maxSeats: 3, computers: 4 },
        updatedByUserId: owner.userId,
      });
      expect(await organizationEntitlements(system, plans, owner.spaceId)).toMatchObject({
        plan: "personal",
        maxSeats: 3,
        computers: 4,
        computerSize: "small",
      });
      await expect(
        invite([`o1-${stamp}@corvo.test`, `o2-${stamp}@corvo.test`]),
      ).resolves.toBeTruthy();
      await expect(invite([`o3-${stamp}@corvo.test`])).rejects.toBeInstanceOf(SeatLimitError);
      await setOrganizationOverride(system, {
        organizationId: owner.spaceId,
        override: {},
        updatedByUserId: owner.userId,
      });
      expect(await organizationEntitlements(system, plans, owner.spaceId)).toMatchObject({
        maxSeats: 1,
        computers: 1,
      });
    });

    it("does nothing without plans", async () => {
      vi.stubEnv("PLAN_PRICES", "");
      await subscribe(null, null);
      await expect(
        invite([`f1-${stamp}@corvo.test`, `f2-${stamp}@corvo.test`, `f3-${stamp}@corvo.test`]),
      ).resolves.toBeTruthy();
    });
  });
});
