import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

function setup(options: { admins?: string[]; email?: string; owned?: boolean } = {}) {
  const partnerRow = {
    id: "partner-1",
    name: "Acme SaaS",
    keyPrefix: "cpk_ABCDEFGH",
    ownerUserId: "user-1",
    template: null as unknown,
    perTenantLimitCents: 600 as number | null,
    monthlyLimitCents: null as number | null,
  };
  const prisma = {
    partner: {
      findUnique: vi.fn(async () => (options.owned ? partnerRow : null)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...partnerRow,
        ...data,
      })),
      update: vi.fn(async () => partnerRow),
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: vi.fn(async () => partnerRow),
    },
    member: { findFirst: vi.fn(async () => ({ organizationId: "owner-org" })) },
    partnerMember: { upsert: vi.fn(async () => ({})) },
    modelCreditEntry: {
      aggregate: vi.fn(async () => ({ _sum: { amountMicros: -2_500_000n } })),
      groupBy: vi.fn(async () => [
        { organizationId: "org-1", _sum: { amountMicros: -1_200_000n } },
      ]),
    },
    modelCreditAccount: {
      findUnique: vi.fn(async () => ({ balanceMicros: 7_500_000n })),
      findMany: vi.fn(async () => [{ organizationId: "org-1", balanceMicros: 3_800_000n }]),
    },
    partnerTenant: {
      findMany: vi.fn(async () => [
        {
          externalTenantId: "shop-1",
          state: "enabled",
          organizationId: "org-1",
          organization: { name: "Shop One" },
        },
      ]),
      findUnique: vi.fn(async () => ({ ownerUserId: "owner-1", testMode: false })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    env: {
      partnerAdminEmails: options.admins ?? ["boss@corvo.test"],
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const actor = {
    spaceId: "space-1",
    userId: "user-1",
    email: options.email ?? "boss@corvo.test",
    isDeploymentOwner: false,
  } satisfies Actor;
  return { client: createRouterClient(createRouter(deps), { context: { actor } }), prisma };
}

describe("partner account", () => {
  it("is not found for everyone the deployment did not name", async () => {
    const { client, prisma } = setup({ email: "someone@corvo.test" });
    await expect(client.partner.status()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.partner.create({ name: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client.partner.rotateKey()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client.partner.setTenantState({ externalTenantId: "shop-1", state: "suspended" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.partner.create).not.toHaveBeenCalled();
  });

  it("matches the named emails without regard to case", async () => {
    const { client } = setup({ admins: ["Boss@Corvo.test"], email: "BOSS@corvo.TEST" });
    await expect(client.partner.status()).resolves.toEqual({ partner: null });
  });

  it("shows no partner until the person becomes one, then name, key start and customers", async () => {
    await expect(setup().client.partner.status()).resolves.toEqual({ partner: null });
    await expect(setup({ owned: true }).client.partner.status()).resolves.toEqual({
      partner: {
        name: "Acme SaaS",
        keyPrefix: "cpk_ABCDEFGH",
        template: null,
        wallet: { balanceUsd: 7.5, passedOnUsd: 2.5, perTenantLimitUsd: 6, monthlyLimitUsd: null },
        tenants: [
          {
            externalTenantId: "shop-1",
            name: "Shop One",
            state: "enabled",
            usedUsd: 1.2,
            balanceUsd: 3.8,
          },
        ],
      },
    });
  });

  it("becomes a partner and hands back the key once", async () => {
    const { client, prisma } = setup();
    const { key } = await client.partner.create({ name: "Acme SaaS" });
    expect(key).toMatch(/^cpk_/);
    // The owner's organization manages the new partner in the console.
    expect(prisma.partnerMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ organizationId: "owner-org" }),
      }),
    );
  });

  it("rotates the key and changes a customer's state only within the caller's own partner", async () => {
    const { client, prisma } = setup({ owned: true });
    await expect(client.partner.rotateKey()).resolves.toMatchObject({
      key: expect.stringMatching(/^cpk_/),
    });
    await expect(
      client.partner.setTenantState({ externalTenantId: "shop-1", state: "suspended" }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.partnerTenant.updateMany).toHaveBeenCalledWith({
      where: { partnerId: "partner-1", externalTenantId: "shop-1", testMode: false },
      data: { state: "suspended" },
    });
    // Whoever has the customer's frame open is signed out at once.
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: "owner-1" } });
  });

  it("saves the limits in whole cents, and null removes one", async () => {
    const { client, prisma } = setup({ owned: true });
    await expect(
      client.partner.setLimits({ perTenantLimitUsd: 12.345, monthlyLimitUsd: null }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.partner.update).toHaveBeenCalledWith({
      where: { id: "partner-1" },
      data: { perTenantLimitCents: 1235, monthlyLimitCents: null },
    });
    await expect(
      setup().client.partner.setLimits({ perTenantLimitUsd: 1, monthlyLimitUsd: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("says not found when changing a customer the partner does not have, or when not a partner", async () => {
    const own = setup({ owned: true });
    (own.prisma.partnerTenant.updateMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      count: 0,
    });
    await expect(
      own.client.partner.setTenantState({ externalTenantId: "nope", state: "suspended" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setup().client.partner.setTenantState({ externalTenantId: "shop-1", state: "suspended" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("saves a template for the caller's partner and refuses one whose address is not allowed", async () => {
    const { client, prisma } = setup({ owned: true });
    const template = {
      connector: { slug: "acme", name: "Acme", endpoint: "https://93.184.216.34/mcp" },
      agents: [{ key: "m", name: "M", instructions: "Go.", usesConnector: true }],
    };
    await expect(client.partner.setTemplate({ template })).resolves.toEqual({ ok: true });
    expect(prisma.partner.updateMany).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1" },
      data: { template },
    });
    await expect(
      client.partner.setTemplate({
        template: {
          ...template,
          connector: { ...template.connector, endpoint: "http://127.0.0.1/mcp" },
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(setup().client.partner.setTemplate({ template })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("tells the app who may open the page, through me", async () => {
    // me() needs more of the database than this fixture has; the flag is a pure function of env.
    const { isPartnerAdmin } = await import("./routes/partner.js");
    expect(isPartnerAdmin({ partnerAdminEmails: ["a@b.test"] }, "A@B.test")).toBe(true);
    expect(isPartnerAdmin({ partnerAdminEmails: ["a@b.test"] }, "c@b.test")).toBe(false);
    expect(isPartnerAdmin({}, "a@b.test")).toBe(false);
  });
});
