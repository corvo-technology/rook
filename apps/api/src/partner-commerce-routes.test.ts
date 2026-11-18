import type { CommerceBalance, IdempotentOutcome } from "@corvo/db";
import { CommerceError, requestHash } from "@corvo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { CommercePartnerAuth, PartnerCommerceDeps } from "./partner-commerce-routes.js";
import { mountPartnerCommerceRoutes } from "./partner-commerce-routes.js";

const KEY_COMMERCE = "cpk_COMMERCE.key";
const KEY_READONLY = "cpk_READONLY.key";
const KEY_WALLET = "cpk_WALLET00.key";
const KEY_OTHER = "cpk_OTHER000.key";
const NOW = new Date("2026-11-05T12:00:00.000Z");

const partner = (id: string, scopes: string[], billingModel = "commerce"): CommercePartnerAuth => ({
  id,
  scopes,
  billingModel,
  currency: "BRL",
  commissionBps: 2000,
});

const BALANCE: CommerceBalance = {
  currency: "BRL",
  period: "2026-11",
  planKey: "team",
  planName: "Team",
  state: "active",
  periodEnd: new Date("2026-12-01T00:00:00Z"),
  plan: {
    grantedMinor: 20000,
    usedMinor: 16100,
    remainingMinor: 3900,
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  },
  topup: { remainingMinor: 5000 },
  remainingMinor: 8900,
  fxRate: "5.12000000",
  lowThresholdReached: true,
};

function fixture() {
  const partners: Record<string, CommercePartnerAuth> = {
    [KEY_COMMERCE]: partner("a", ["tenants:write", "commerce:read", "commerce:write"]),
    [KEY_READONLY]: partner("r", ["commerce:read"]),
    [KEY_WALLET]: partner("w", ["tenants:write", "commerce:read", "commerce:write"], "wallet"),
    [KEY_OTHER]: partner("b", ["commerce:read", "commerce:write"]),
  };
  const tenants = new Map([
    [
      "a/clinic-1",
      { id: "t1", organizationId: "org1", externalTenantId: "clinic-1", state: "enabled" },
    ],
  ]);
  const records = new Map<string, { hash: string; body?: unknown }>();
  const topups = vi.fn(async () => ({
    events: ["e1"],
    body: { topupId: "g1", creditMinor: 5000 },
  }));
  const notify = vi.fn(async () => undefined);
  const deps: PartnerCommerceDeps = {
    now: () => NOW,
    allowRequest: async () => true,
    authenticate: async (key) => partners[key] ?? null,
    findTenant: async (partnerId, external) => tenants.get(`${partnerId}/${external}`) ?? null,
    catalog: async (currency) => ({
      currency,
      plans: [{ key: "team", name: "Team", baseMinor: 49900, creditMinor: 20000 }],
      packs: [{ key: "pack_s", name: "Small", baseMinor: 5000, creditMinor: 5000 }],
    }),
    markups: async (partnerId) =>
      partnerId === "a"
        ? new Map([
            ["plan:team", { kind: "percent" as const, value: 1500 }],
            ["pack:pack_s", { kind: "fixed" as const, value: 700 }],
          ])
        : new Map(),
    setSubscription: vi.fn(async (_p, _t, input) => {
      if (input.plan === "nope") throw new CommerceError("unknown_plan");
      return { events: [], body: { plan: input.plan, status: input.status } };
    }),
    topup: topups,
    refund: vi.fn(async () => {
      throw new CommerceError("refund_exceeds");
    }),
    balance: async () => BALANCE,
    usage: async (_p, _t, period) => ({ period, usedMinor: 0, byDay: [] }),
    // The same contract as the database implementation, in memory.
    idempotent: async (partnerId, key, hash, run): Promise<IdempotentOutcome> => {
      const id = `${partnerId}/${key}`;
      const seen = records.get(id);
      if (seen) {
        return seen.hash === hash
          ? { kind: "replay", status: 200, body: seen.body }
          : { kind: "conflict" };
      }
      const result = await run();
      if (result.status < 300) records.set(id, { hash, body: result.body });
      return { kind: "ran", ...result };
    },
    notify,
  };
  const app = new Hono();
  mountPartnerCommerceRoutes(app, deps);
  const call = (
    method: string,
    path: string,
    key: string | null,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`/api/partner/v1${path}`, {
      method,
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(body && method !== "GET" ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body && method !== "GET" ? JSON.stringify(body) : undefined,
    });
  return { call, deps, topups, notify };
}

const TOPUP = { pack: "pack_s", quantity: 1, paidMinor: 5500, externalPaymentId: "pay_1" };
const SUBSCRIPTION = {
  plan: "team",
  status: "active",
  currentPeriodStart: "2026-11-01T00:00:00Z",
  currentPeriodEnd: "2026-12-01T00:00:00Z",
  chargedMinor: 54900,
};

describe("partner commerce API", () => {
  it("answers the catalog with the partner's markup added, in minor units", async () => {
    const { call } = fixture();
    const response = await call("GET", "/catalog", KEY_COMMERCE);
    expect(response.status).toBe(200);
    // 15% of 49900 rounds down to 7485; the fixed markup on the pack is 700.
    expect(await response.json()).toEqual({
      currency: "BRL",
      plans: [
        { key: "team", baseMinor: 49900, markupMinor: 7485, priceMinor: 57385, creditMinor: 20000 },
      ],
      packs: [
        { key: "pack_s", baseMinor: 5000, markupMinor: 700, priceMinor: 5700, creditMinor: 5000 },
      ],
    });
  });

  it("answers the base price for a partner that set no markup", async () => {
    const { call } = fixture();
    const response = await call("GET", "/catalog", KEY_OTHER);
    expect(await response.json()).toMatchObject({
      plans: [{ markupMinor: 0, priceMinor: 49900 }],
    });
  });

  it("AC7: a wallet partner is refused with 409 on every commerce route, a wrong key is one 401", async () => {
    const { call } = fixture();
    for (const [method, path] of [
      ["GET", "/catalog"],
      ["GET", "/tenants/clinic-1/balance"],
      ["GET", "/tenants/clinic-1/usage?period=2026-11"],
      ["PUT", "/tenants/clinic-1/subscription"],
      ["POST", "/tenants/clinic-1/topups"],
      ["POST", "/tenants/clinic-1/refunds"],
    ] as const) {
      const response = await call(method, path, KEY_WALLET, {}, { "idempotency-key": "k" });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "not_commerce_partner" });
      expect(
        (await call(method, path, "cpk_WRONG000.nope", {}, { "idempotency-key": "k" })).status,
      ).toBe(401);
      expect((await call(method, path, null)).status).toBe(401);
    }
  });

  it("checks the key's scope after authentication", async () => {
    const { call } = fixture();
    expect((await call("GET", "/tenants/clinic-1/balance", KEY_READONLY)).status).toBe(404); // reads are allowed; clinic-1 is not its customer
    const write = await call("POST", "/tenants/clinic-1/topups", KEY_READONLY, TOPUP, {
      "idempotency-key": "k",
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: "scope" });
  });

  it("isolation: another partner's customer is a 404 on every tenant route", async () => {
    const { call } = fixture();
    for (const [method, path, body] of [
      ["GET", "/tenants/clinic-1/balance", undefined],
      ["GET", "/tenants/clinic-1/usage?period=2026-11", undefined],
      ["PUT", "/tenants/clinic-1/subscription", SUBSCRIPTION],
      ["POST", "/tenants/clinic-1/topups", TOPUP],
      ["POST", "/tenants/clinic-1/refunds", { externalPaymentId: "pay_1" }],
    ] as const) {
      const response = await call(method, path, KEY_OTHER, body, { "idempotency-key": "k" });
      expect(response.status).toBe(404);
    }
  });

  it("reads the balance in the shape of the spec", async () => {
    const { call } = fixture();
    const response = await call("GET", "/tenants/clinic-1/balance", KEY_COMMERCE);
    expect(await response.json()).toEqual({
      currency: "BRL",
      period: "2026-11",
      state: "active",
      plan: {
        grantedMinor: 20000,
        usedMinor: 16100,
        remainingMinor: 3900,
        expiresAt: "2026-12-01T00:00:00.000Z",
      },
      topup: { remainingMinor: 5000 },
      remainingMinor: 8900,
      fxRate: "5.12000000",
    });
    expect((await call("GET", "/tenants/clinic-1/usage?period=nope", KEY_COMMERCE)).status).toBe(
      400,
    );
  });

  it("requires an Idempotency-Key on money calls", async () => {
    const { call, topups } = fixture();
    const response = await call("POST", "/tenants/clinic-1/topups", KEY_COMMERCE, TOPUP);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
    expect(topups).not.toHaveBeenCalled();
  });

  it("AC2: a top-up is 201 once, 200 with the same answer on repeat, and 409 for another body", async () => {
    const { call, topups, notify } = fixture();
    const headers = { "idempotency-key": "pay_1" };
    const first = await call("POST", "/tenants/clinic-1/topups", KEY_COMMERCE, TOPUP, headers);
    expect(first.status).toBe(201);
    const second = await call("POST", "/tenants/clinic-1/topups", KEY_COMMERCE, TOPUP, headers);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.clone().json());
    expect(topups).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    const other = await call(
      "POST",
      "/tenants/clinic-1/topups",
      KEY_COMMERCE,
      { ...TOPUP, paidMinor: 1 },
      headers,
    );
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "idempotency_conflict" });
    expect(topups).toHaveBeenCalledTimes(1);
  });

  it("hashes the same body the same way whatever the key order", () => {
    expect(requestHash("POST /x", { a: 1, b: { c: 2, d: 3 } })).toBe(
      requestHash("POST /x", { b: { d: 3, c: 2 }, a: 1 }),
    );
    expect(requestHash("POST /x", { a: 1 })).not.toBe(requestHash("PUT /x", { a: 1 }));
  });

  it("turns a refusal into its status and does not remember it", async () => {
    const { call, deps } = fixture();
    const headers = { "idempotency-key": "k9" };
    const refused = await call(
      "PUT",
      "/tenants/clinic-1/subscription",
      KEY_COMMERCE,
      { ...SUBSCRIPTION, plan: "nope" },
      headers,
    );
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: "unknown_plan" });
    const ok = await call(
      "PUT",
      "/tenants/clinic-1/subscription",
      KEY_COMMERCE,
      { ...SUBSCRIPTION, plan: "team" },
      headers,
    );
    // The key was free to use again, with a body that differs from the refused one.
    expect(ok.status).toBe(200);
    expect(deps.setSubscription).toHaveBeenCalledTimes(2);
    const refund = await call(
      "POST",
      "/tenants/clinic-1/refunds",
      KEY_COMMERCE,
      { externalPaymentId: "p" },
      { "idempotency-key": "r" },
    );
    expect(refund.status).toBe(409);
  });

  it("refuses an invalid body, and a trial status, which is not offered", async () => {
    const { call } = fixture();
    const headers = { "idempotency-key": "k" };
    expect(
      (
        await call(
          "PUT",
          "/tenants/clinic-1/subscription",
          KEY_COMMERCE,
          { ...SUBSCRIPTION, status: "trialing" },
          headers,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          "/tenants/clinic-1/topups",
          KEY_COMMERCE,
          { ...TOPUP, quantity: 0 },
          headers,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "POST",
          "/tenants/clinic-1/topups",
          KEY_COMMERCE,
          { ...TOPUP, paidMinor: 1.5 },
          headers,
        )
      ).status,
    ).toBe(400);
  });
});
