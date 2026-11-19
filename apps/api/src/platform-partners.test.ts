import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: a fake Prisma client drives the real router and the operator gate.

const actor = (email: string) =>
  ({ spaceId: "space-1", userId: "user-1", email, isDeploymentOwner: false }) satisfies Actor;

function setup(email: string) {
  const prisma = {
    partner: {
      findMany: vi.fn(async () => [
        {
          id: "p-a",
          slug: "a",
          name: "Product A",
          mode: "embedded",
          planKey: "starter",
          testDailyCap: 300,
          testUsage: [{ calls: 12 }],
          _count: { tenants: 2 },
        },
        {
          id: "p-b",
          slug: "b",
          name: "Product B",
          mode: "white_label",
          planKey: null,
          testDailyCap: 50,
          testUsage: [],
          _count: { tenants: 0 },
        },
      ]),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "p-a" ? { ownerUserId: "owner-a", walletOwnerUserId: null } : null,
      ),
    },
    partnerTenant: {
      findMany: vi.fn(async ({ where }: { where: { partnerId: string } }) =>
        where.partnerId === "p-a"
          ? [
              { organizationId: "org-1", state: "enabled" },
              { organizationId: "org-2", state: "suspended" },
            ]
          : [],
      ),
    },
    member: { findFirst: vi.fn(async () => ({ organizationId: "org-wallet" })) },
    modelCreditAccount: { findUnique: vi.fn(async () => ({ balanceMicros: 3_000_000n })) },
    modelCreditEntry: {
      findMany: vi.fn(async () => [
        { amountMicros: -1_000_000n, usage: { costUsd: 0.4 } },
        { amountMicros: -1_000_000n, usage: { costUsd: 0.4 } },
      ]),
    },
  };
  const deps = {
    prisma: prisma as unknown as PrismaClient,
    events: { notify: vi.fn(async () => undefined) },
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
      partnerAdminEmails: ["boss@corvo.test"],
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(input?: unknown) {
    const { response } = await handler.handle(
      new Request("http://127.0.0.1/rpc/platform/partners/list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      { prefix: "/rpc", context: { actor: actor(email) } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  }
  return { prisma, call };
}

describe("platform.partners.list", () => {
  it("answers anyone outside the operator list as if the route did not exist", async () => {
    const { call, prisma } = setup("someone@corvo.test");
    expect((await call()).status).toBe(404);
    expect(prisma.partner.findMany).not.toHaveBeenCalled();
  });

  it("gives each partner its customers, fund and the month's use against the provider cost", async () => {
    const { call } = setup("BOSS@corvo.test");
    const result = await call({ period: "2026-11" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      {
        id: "p-a",
        slug: "a",
        name: "Product A",
        mode: "embedded",
        plan: "starter",
        activeCustomers: 1,
        fundBalanceCredits: 300,
        fundPercent: 60,
        chargedCredits: 200,
        costCredits: 80,
        testCustomers: 2,
        testCallsToday: 12,
        testDailyCap: 300,
      },
      {
        id: "p-b",
        slug: "b",
        name: "Product B",
        mode: "white_label",
        plan: null,
        activeCustomers: 0,
        fundBalanceCredits: 0,
        fundPercent: null,
        chargedCredits: 0,
        costCredits: null,
        testCustomers: 0,
        testCallsToday: 0,
        testDailyCap: 50,
      },
    ]);
  });

  it("refuses a period that is not a month", async () => {
    const { call } = setup("boss@corvo.test");
    expect((await call({ period: "2026-13" })).status).toBe(400);
  });
});
