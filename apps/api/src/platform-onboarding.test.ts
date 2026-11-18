import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: an in-memory Prisma stand-in drives the real router, the operator gate and the
// onboarding service, so approving twice can be seen to make and send one thing.

const actor = (email: string) =>
  ({ spaceId: "space-1", userId: "op-1", email, isDeploymentOwner: false }) satisfies Actor;

const tiers = {
  tiers: [
    {
      key: "starter",
      name: "Starter",
      prices: {
        BRL: { priceMinor: 100, includedCredits: 10 },
        USD: { priceMinor: 20, includedCredits: 10 },
      },
    },
  ],
};

type Row = Record<string, unknown>;

function fakeDatabase(options: { existingOwnerOrg?: string } = {}) {
  const waitlist: Row[] = [
    { id: "w1", email: "ana@example.test", company: "Ana Co", status: "pending" },
  ];
  const leads: Row[] = [
    {
      id: "l1",
      name: "Bia",
      email: "bia@example.test",
      company: "Bia Systems",
      status: "pending",
      partnerId: null,
    },
  ];
  const state = {
    partners: [] as Row[],
    members: [] as Row[],
    invitations: [] as Row[],
    organizations: [] as Row[],
    audits: [] as Row[],
  };
  const matches = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => row[k] === v);
  const table = (rows: Row[]) => ({
    findUnique: vi.fn(
      async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    ),
    findMany: vi.fn(async () => rows),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      Object.assign(row as Row, data);
      return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter((r) => matches(r, where));
      for (const row of found) Object.assign(row, data);
      return { count: found.length };
    }),
  });
  const prisma = {
    waitlistEntry: table(waitlist),
    partnerLead: table(leads),
    partner: {
      ...table(state.partners),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `p-${state.partners.length + 1}`,
          planKey: null,
          currency: "USD",
          ...data,
        };
        state.partners.push(row);
        return row;
      }),
    },
    partnerPricingVersion: {
      findFirst: vi.fn(async () => ({ version: 1, config: pricing, createdAt: new Date() })),
    },
    member: {
      findFirst: vi.fn(async () =>
        options.existingOwnerOrg ? { organizationId: options.existingOwnerOrg } : null,
      ),
    },
    partnerMember: {
      upsert: vi.fn(async ({ create }: { create: Row }) => {
        if (!state.members.some((m) => matches(m, create))) state.members.push(create);
      }),
    },
    partnerAuditEvent: {
      create: vi.fn(async ({ data }: { data: Row }) => void state.audits.push(data)),
    },
    tenantSubscription: { count: vi.fn(async () => 0) },
    user: { findUnique: vi.fn(async () => ({ name: "Operator" })) },
    organization: {
      create: vi.fn(async ({ data }: { data: Row }) => void state.organizations.push(data)),
    },
    space: { create: vi.fn(async () => ({})) },
    spaceInvitation: {
      create: vi.fn(async ({ data }: { data: Row }) => void state.invitations.push(data)),
    },
    // Commits when the work finishes and puts every table back when it throws.
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tables = [waitlist, leads, ...Object.values(state)];
      const before = tables.map((rows) => rows.map((row) => ({ ...row })));
      try {
        return await fn(prisma);
      } catch (error) {
        for (const [at, rows] of tables.entries()) {
          rows.splice(0, rows.length, ...(before[at] as Row[]));
        }
        throw error;
      }
    },
  };
  return { prisma, state, waitlist, leads };
}

const pricing = {
  ...tiers,
  costs: { models: {}, voiceMinuteMicros: 0, computerMinuteMicros: 0, storageGbMonthMicros: 0 },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 0,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 0,
};

function setup(options: { existingOwnerOrg?: string; email?: string } = {}) {
  const db = fakeDatabase(options);
  const send = vi.fn(async () => undefined);
  const deps = {
    prisma: db.prisma as unknown as PrismaClient,
    events: { notify: vi.fn(async () => undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
      partnerAdminEmails: ["boss@corvo.test"],
    },
    team: { secret: "team-secret", webOrigin: "http://127.0.0.1:5173", email: { send } },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(path: string, input?: unknown) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/platform/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      { prefix: "/rpc", context: { actor: actor(options.email ?? "boss@corvo.test") } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  }
  return { ...db, call, send };
}

const partner = {
  name: "Bia",
  slug: "bia-app",
  mode: "embedded",
  country: "br",
  planKey: "starter",
};

describe("the waitlist", () => {
  it("is closed to anyone outside the operator list", async () => {
    const { call, prisma } = setup({ email: "someone@corvo.test" });
    expect((await call("waitlist/list")).status).toBe(404);
    expect((await call("waitlist/decide", { id: "w1", decision: "approved" })).status).toBe(404);
    expect(prisma.waitlistEntry.updateMany).not.toHaveBeenCalled();
  });

  it("approves once: one workspace and invitation for the address, one email", async () => {
    const { call, state, waitlist, send } = setup();
    const first = await call("waitlist/decide", { id: "w1", decision: "approved" });
    expect(first).toMatchObject({ status: 200, body: { emailed: true } });
    const again = await call("waitlist/decide", { id: "w1", decision: "approved" });
    expect(again.body).toEqual({ emailed: false });
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0]).toMatchObject({
      email: "ana@example.test",
      role: "owner",
      inviterId: "op-1",
    });
    expect(state.organizations).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(waitlist[0]).toMatchObject({
      status: "approved",
      decidedByUserId: "op-1",
      invitationId: state.invitations[0]?.id,
    });
  });

  it("declines without inviting, and a declined entry cannot be approved afterwards", async () => {
    const { call, state, waitlist } = setup();
    await call("waitlist/decide", { id: "w1", decision: "declined" });
    await call("waitlist/decide", { id: "w1", decision: "approved" });
    expect(waitlist[0]?.status).toBe("declined");
    expect(state.invitations).toHaveLength(0);
  });

  it("answers an unknown entry as not found", async () => {
    const { call } = setup();
    expect((await call("waitlist/decide", { id: "nope", decision: "approved" })).status).toBe(404);
  });
});

describe("partner applications", () => {
  it("is closed to anyone outside the operator list", async () => {
    const { call, state } = setup({ email: "someone@corvo.test" });
    expect((await call("partnerLeads/list")).status).toBe(404);
    expect((await call("partnerLeads/approve", { id: "l1", partner })).status).toBe(404);
    expect(
      (await call("partners/create", { ...partner, ownerEmail: "x@example.test" })).status,
    ).toBe(404);
    expect(state.partners).toHaveLength(0);
  });

  it("approves once: the partner, its owner's invitation and the console link, and one email", async () => {
    const { call, state, leads, send } = setup();
    const first = await call("partnerLeads/approve", { id: "l1", partner });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ partnerId: "p-1", emailed: true });
    const second = await call("partnerLeads/approve", { id: "l1", partner });
    expect(second.body).toEqual({ partnerId: "p-1", emailed: false });
    expect(state.partners).toHaveLength(1);
    expect(state.partners[0]).toMatchObject({
      slug: "bia-app",
      mode: "embedded",
      currency: "BRL",
      country: "BR",
      billingModel: "commerce",
      planKey: "starter",
    });
    expect(state.invitations).toHaveLength(1);
    expect(state.invitations[0]).toMatchObject({ email: "bia@example.test", role: "owner" });
    expect(state.members).toEqual([
      { partnerId: "p-1", organizationId: state.organizations[0]?.id },
    ]);
    expect(state.audits).toEqual([
      expect.objectContaining({ partnerId: "p-1", actorUserId: "op-1", kind: "partner.created" }),
    ]);
    expect(JSON.stringify(state.audits)).not.toContain("example.test");
    expect(send).toHaveBeenCalledTimes(1);
    expect(leads[0]).toMatchObject({ status: "approved", partnerId: "p-1" });
  });

  it("links an owner's existing organization instead of inviting", async () => {
    const { call, state, send } = setup({ existingOwnerOrg: "org-existing" });
    const result = await call("partnerLeads/approve", { id: "l1", partner });
    expect(result.body).toMatchObject({ partnerId: "p-1", emailed: false });
    expect(state.members).toEqual([{ partnerId: "p-1", organizationId: "org-existing" }]);
    expect(state.invitations).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a plan that is not in the published pricing, and puts the application back", async () => {
    const { call, state, leads } = setup();
    const result = await call("partnerLeads/approve", {
      id: "l1",
      partner: { ...partner, planKey: "nope" },
    });
    expect(result.status).toBe(400);
    expect(state.partners).toHaveLength(0);
    expect(leads[0]?.status).toBe("pending");
  });

  it("declines with a reason and sends nothing", async () => {
    const { call, leads, send, state } = setup();
    expect((await call("partnerLeads/decline", { id: "l1", reason: " not a fit " })).status).toBe(
      200,
    );
    expect(leads[0]).toMatchObject({ status: "declined", declineReason: "not a fit" });
    expect(send).not.toHaveBeenCalled();
    expect(state.partners).toHaveLength(0);
  });

  it("makes a partner without an application, and refuses a slug already taken", async () => {
    const { call, state } = setup();
    const body = { ...partner, mode: "referral", planKey: null, ownerEmail: "new@example.test" };
    expect((await call("partners/create", body)).status).toBe(200);
    expect(state.partners[0]).toMatchObject({ mode: "referral", currency: "BRL" });
    expect((await call("partners/create", body)).status).toBe(409);
    expect(state.partners).toHaveLength(1);
  });
});

describe("a failure midway", () => {
  it("leaves nothing behind, keeps the application pending, and a retry works", async () => {
    const { call, state, leads, send, prisma } = setup();
    prisma.partnerMember.upsert.mockRejectedValueOnce(new Error("database went away"));
    expect((await call("partnerLeads/approve", { id: "l1", partner })).status).toBe(500);
    expect(state.partners).toHaveLength(0);
    expect(state.organizations).toHaveLength(0);
    expect(state.invitations).toHaveLength(0);
    expect(state.members).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(leads[0]).toMatchObject({ status: "pending", partnerId: null });
    expect(send).not.toHaveBeenCalled();

    const retry = await call("partnerLeads/approve", { id: "l1", partner });
    expect(retry.body).toMatchObject({ partnerId: "p-1", emailed: true });
    expect(state.partners).toHaveLength(1);
    expect(state.invitations).toHaveLength(1);
  });

  it("leaves a waitlist entry pending when its invitation cannot be made", async () => {
    const { call, waitlist, state, send, prisma } = setup();
    prisma.spaceInvitation.create.mockRejectedValueOnce(new Error("database went away"));
    expect((await call("waitlist/decide", { id: "w1", decision: "approved" })).status).toBe(500);
    expect(waitlist[0]?.status).toBe("pending");
    expect(state.organizations).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect((await call("waitlist/decide", { id: "w1", decision: "approved" })).body).toEqual({
      emailed: true,
    });
  });
});
