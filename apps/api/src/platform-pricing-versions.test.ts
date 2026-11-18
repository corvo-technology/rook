import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: a fake Prisma client drives the real router and the operator gate.

const config = {
  tiers: [],
  costs: { models: {}, voiceMinuteMicros: 0, computerMinuteMicros: 0, storageGbMonthMicros: 0 },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 0,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 0,
};

function setup(email: string) {
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const prisma = {
    partnerPricingVersion: {
      findFirst: vi.fn(async () => ({
        version: 2,
        config,
        createdAt: day("2026-11-01"),
        effectiveAt: day("2026-11-01"),
      })),
      findMany: vi.fn(async () => [
        { version: 3, createdAt: day("2026-11-05"), effectiveAt: day("2999-01-01") },
        { version: 2, createdAt: day("2026-11-01"), effectiveAt: day("2026-11-01") },
        { version: 1, createdAt: day("2026-10-01"), effectiveAt: day("2026-10-01") },
      ]),
      create: vi.fn(async () => ({})),
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
  async function call(path: string, input?: unknown) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/platform/partnerPricing/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      {
        prefix: "/rpc",
        context: {
          actor: {
            spaceId: "space-1",
            userId: "op-1",
            email,
            isDeploymentOwner: false,
          } satisfies Actor,
        },
      },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  }
  return { prisma, call };
}

describe("platform.partnerPricing versions", () => {
  it("is closed to anyone outside the operator list", async () => {
    const { call, prisma } = setup("someone@corvo.test");
    expect((await call("history")).status).toBe(404);
    expect((await call("publish", { config })).status).toBe(404);
    expect(prisma.partnerPricingVersion.create).not.toHaveBeenCalled();
  });

  it("tells when the live version started, and lists what is live, scheduled and past", async () => {
    const { call } = setup("boss@corvo.test");
    expect((await call("get")).body).toMatchObject({
      version: 2,
      effectiveAt: "2026-11-01T00:00:00.000Z",
    });
    const history = await call("history");
    expect(
      history.body.map((row: { version: number; status: string }) => [row.version, row.status]),
    ).toEqual([
      [3, "scheduled"],
      [2, "live"],
      [1, "past"],
    ]);
  });

  it("publishes from a future day, and refuses a day that has passed", async () => {
    const { call, prisma } = setup("boss@corvo.test");
    const future = await call("publish", { config, effectiveOn: "2999-01-01" });
    expect(future).toMatchObject({ status: 200, body: { version: 3 } });
    expect(prisma.partnerPricingVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ effectiveAt: new Date("2999-01-01T00:00:00.000Z") }),
    });
    prisma.partnerPricingVersion.create.mockClear();
    expect((await call("publish", { config, effectiveOn: "2020-01-01" })).status).toBe(400);
    expect(prisma.partnerPricingVersion.create).not.toHaveBeenCalled();
  });
});
