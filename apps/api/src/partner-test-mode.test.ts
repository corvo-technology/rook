import { PartnerTenantModeMismatch } from "@corvo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CommercePartnerAuth, PartnerCommerceDeps } from "./partner-commerce-routes.js";
import { mountPartnerCommerceRoutes } from "./partner-commerce-routes.js";
import type { PartnerRouteDeps } from "./partner-routes.js";
import { mountPartnerRoutes } from "./partner-routes.js";

const LIVE_KEY = "cpk_LIVEKEY0.live";
const TEST_KEY = "cpk_test_TESTKEY0.test";
const WALLET_KEY = "cpk_WALLET00.live";
const WALLET_TEST_KEY = "cpk_test_WALLET00.test";
const NOW = new Date("2026-11-05T12:00:00.000Z");

interface Row {
  id: string;
  organizationId: string;
  ownerUserId: string;
  externalTenantId: string;
  state: string;
  testMode: boolean;
}

function fixture() {
  const partners: Record<string, CommercePartnerAuth> = {
    [LIVE_KEY]: {
      id: "p1",
      billingModel: "commerce",
      currency: "BRL",
      commissionBps: 2000,
      scopes: ["tenants:write", "commerce:read", "commerce:write"],
      testMode: false,
    },
    [TEST_KEY]: {
      id: "p1",
      billingModel: "commerce",
      currency: "BRL",
      commissionBps: 2000,
      scopes: ["tenants:write", "commerce:read", "commerce:write"],
      testMode: true,
    },
  };
  const wallet = { currency: "USD", commissionBps: 2000, scopes: ["tenants:write"] };
  partners[WALLET_KEY] = { id: "p2", billingModel: "wallet", testMode: false, ...wallet };
  partners[WALLET_TEST_KEY] = { id: "p2", billingModel: "wallet", testMode: true, ...wallet };
  const tenants = new Map<string, Row>();
  const allowances: unknown[] = [];
  const real = {
    setSubscription: vi.fn(),
    topup: vi.fn(),
    refund: vi.fn(),
    balance: vi.fn(),
    usage: vi.fn(),
    grantAllowance: vi.fn(async (_tenant: unknown, input: unknown) => {
      allowances.push(input);
    }),
  };
  const notices: Array<{ kind: string; tenant: string }> = [];
  const notify = vi.fn(async () => undefined);
  const findTenant = async (partnerId: string, external: string, testMode = false) => {
    const row = tenants.get(`${partnerId}/${external}`);
    return row && row.testMode === testMode ? row : null;
  };

  const routeDeps = {
    webOrigin: "https://app.example.test",
    now: () => NOW,
    allowRequest: async () => true,
    authenticate: async (key: string) => partners[key] ?? null,
    provision: async (
      partner: { id: string; testMode?: boolean },
      input: { externalTenantId: string; name: string },
    ) => {
      const id = `${partner.id}/${input.externalTenantId}`;
      const existing = tenants.get(id);
      if (existing) {
        if (existing.testMode !== (partner.testMode === true))
          throw new PartnerTenantModeMismatch();
        return {
          tenantId: existing.id,
          organizationId: existing.organizationId,
          spaceId: existing.organizationId,
          ownerUserId: existing.ownerUserId,
          created: false,
        };
      }
      const n = tenants.size + 1;
      const row: Row = {
        id: `tenant-${n}`,
        organizationId: `org-${n}`,
        ownerUserId: `owner-${n}`,
        externalTenantId: input.externalTenantId,
        state: "enabled",
        testMode: partner.testMode === true,
      };
      tenants.set(id, row);
      return {
        tenantId: row.id,
        organizationId: row.organizationId,
        spaceId: row.organizationId,
        ownerUserId: row.ownerUserId,
        created: true,
      };
    },
    findTenant,
    setState: async (partnerId: string, external: string, state: string, testMode = false) => {
      const row = await findTenant(partnerId, external, testMode);
      if (!row) return false;
      row.state = state;
      return true;
    },
    ensureChief: async () => undefined,
    install: async () => undefined,
    grantAllowance: real.grantAllowance,
    storeEntryCode: async () => undefined,
  } satisfies PartnerRouteDeps;

  const commerceDeps: PartnerCommerceDeps = {
    now: () => NOW,
    allowRequest: async () => true,
    authenticate: async (key) => partners[key] ?? null,
    findTenant,
    catalog: async (currency) => ({
      currency,
      plans: [{ key: "team", name: "Team", baseMinor: 49900, creditMinor: 20000 }],
      packs: [{ key: "pack_s", name: "Small", baseMinor: 5000, creditMinor: 5000 }],
    }),
    markups: async () => new Map(),
    setSubscription: real.setSubscription,
    topup: real.topup,
    refund: real.refund,
    balance: real.balance,
    usage: real.usage,
    idempotent: async (_partnerId, _key, _hash, run) => ({ kind: "ran", ...(await run()) }),
    notify,
    testNotice: async (_partner, tenant, notice) => {
      notices.push({ kind: notice.kind, tenant: tenant.externalTenantId });
      return ["event-1"];
    },
  };
  const app = new Hono();
  mountPartnerRoutes(app, routeDeps);
  mountPartnerCommerceRoutes(app, commerceDeps);
  const call = (method: string, path: string, key: string, body?: unknown) =>
    app.request(`/api/partner/v1${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        "idempotency-key": "key-0001",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { call, tenants, real, allowances, notices, notify };
}

const SUBSCRIPTION = {
  plan: "team",
  status: "active",
  currentPeriodStart: "2026-11-01T00:00:00Z",
  currentPeriodEnd: "2026-12-01T00:00:00Z",
};

describe("partner test mode: isolation", () => {
  it("makes a test customer with the test key and flags it", async () => {
    const { call, tenants } = fixture();
    const response = await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: true, test: true });
    expect(tenants.get("p1/try-1")?.testMode).toBe(true);
    const live = await call("PUT", "/tenants/real-1", LIVE_KEY, { name: "Real" });
    expect(await live.json()).not.toHaveProperty("test");
    expect(tenants.get("p1/real-1")?.testMode).toBe(false);
  });

  it("does not let the test key reach a live customer, or the live key a test one", async () => {
    const { call, tenants } = fixture();
    await call("PUT", "/tenants/real-1", LIVE_KEY, { name: "Real" });
    await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });

    // Sessions, state changes and commerce all answer as for any customer that is not there.
    expect(
      (
        await call("POST", "/sessions", TEST_KEY, {
          externalTenantId: "real-1",
          externalUserId: "u",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call("POST", "/sessions", LIVE_KEY, {
          externalTenantId: "try-1",
          externalUserId: "u",
        })
      ).status,
    ).toBe(404);
    expect((await call("POST", "/tenants/real-1/suspend", TEST_KEY)).status).toBe(404);
    expect((await call("POST", "/tenants/try-1/suspend", LIVE_KEY)).status).toBe(404);
    expect((await call("GET", "/tenants/real-1/balance", TEST_KEY)).status).toBe(404);
    expect((await call("GET", "/tenants/try-1/balance", LIVE_KEY)).status).toBe(404);
    expect(tenants.get("p1/real-1")?.state).toBe("enabled");
    expect(tenants.get("p1/try-1")?.state).toBe("enabled");

    // Making a customer under an id of the other mode is refused, not reused.
    const clash = await call("PUT", "/tenants/real-1", TEST_KEY, { name: "x" });
    expect(clash.status).toBe(409);
    expect(await clash.json()).toEqual({ error: "tenant_mode" });
    expect((await call("PUT", "/tenants/try-1", LIVE_KEY, { name: "x" })).status).toBe(409);
  });

  it("opens a session for a test customer with the test key", async () => {
    const { call } = fixture();
    await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });
    const response = await call("POST", "/sessions", TEST_KEY, {
      externalTenantId: "try-1",
      externalUserId: "u",
    });
    expect(response.status).toBe(200);
  });
});

describe("partner test mode: nothing is billed", () => {
  it("never gives a test customer an allowance", async () => {
    const { call, allowances } = fixture();
    await call("PUT", "/tenants/try-1", WALLET_TEST_KEY, { name: "Try", allowanceCents: 5000 });
    expect(allowances).toHaveLength(0);
    await call("PUT", "/tenants/real-1", WALLET_KEY, { name: "Real", allowanceCents: 5000 });
    expect(allowances).toHaveLength(1);
  });

  it("simulates the commerce calls without recording any money", async () => {
    const { call, real } = fixture();
    await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });

    const sub = await call("PUT", "/tenants/try-1/subscription", TEST_KEY, SUBSCRIPTION);
    expect(sub.status).toBe(200);
    expect(await sub.json()).toMatchObject({ test: true, plan: "team", rookShareMinor: 0 });
    const topup = await call("POST", "/tenants/try-1/topups", TEST_KEY, {
      pack: "pack_s",
      quantity: 2,
      paidMinor: 10000,
      externalPaymentId: "pay_1",
    });
    expect(topup.status).toBe(201);
    expect(await topup.json()).toMatchObject({ test: true, creditMinor: 10000, rookShareMinor: 0 });
    const refund = await call("POST", "/tenants/try-1/refunds", TEST_KEY, {
      externalPaymentId: "pay_1",
    });
    expect(refund.status).toBe(201);
    const balance = await call("GET", "/tenants/try-1/balance", TEST_KEY);
    expect(await balance.json()).toMatchObject({ test: true, state: "active" });
    const usage = await call("GET", "/tenants/try-1/usage?period=2026-11", TEST_KEY);
    expect(await usage.json()).toMatchObject({ test: true, usedMinor: 0 });

    // Nothing reached the ledger, the credit lots or the invoices.
    for (const spy of [real.setSubscription, real.topup, real.refund, real.balance, real.usage]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("still checks the plan and pack, so a wrong call fails in test as it would live", async () => {
    const { call } = fixture();
    await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });
    const plan = await call("PUT", "/tenants/try-1/subscription", TEST_KEY, {
      ...SUBSCRIPTION,
      plan: "nope",
    });
    expect(plan.status).toBe(422);
    const pack = await call("POST", "/tenants/try-1/topups", TEST_KEY, {
      pack: "nope",
      quantity: 1,
      paidMinor: 1,
      externalPaymentId: "p",
    });
    expect(pack.status).toBe(422);
  });

  it("sends the test webhook a notice for a past due test subscription", async () => {
    const { call, notices, notify } = fixture();
    await call("PUT", "/tenants/try-1", TEST_KEY, { name: "Try" });
    await call("PUT", "/tenants/try-1/subscription", TEST_KEY, {
      ...SUBSCRIPTION,
      status: "past_due",
    });
    expect(notices).toEqual([{ kind: "subscription.lapsed", tenant: "try-1" }]);
    expect(notify).toHaveBeenCalledWith(["event-1"]);
    // An active one owes nothing.
    notices.length = 0;
    await call("PUT", "/tenants/try-1/subscription", TEST_KEY, SUBSCRIPTION);
    expect(notices).toEqual([]);
  });

  it("charges a live customer through the real path, as before", async () => {
    const { call, real } = fixture();
    real.setSubscription.mockResolvedValue({ events: [], body: { plan: "team" } });
    await call("PUT", "/tenants/real-1", LIVE_KEY, { name: "Real" });
    const response = await call("PUT", "/tenants/real-1/subscription", LIVE_KEY, SUBSCRIPTION);
    expect(response.status).toBe(200);
    expect(real.setSubscription).toHaveBeenCalledTimes(1);
  });
});
