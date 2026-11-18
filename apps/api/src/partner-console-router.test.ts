import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

// Offline boundary: a fake Prisma client drives the real router, permission check and service.

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

const partnerRow = {
  id: "p-a",
  slug: "slug-a",
  name: "Product A",
  mode: "embedded",
  currency: "BRL",
  billingModel: "commerce",
  commissionBps: 2000,
  checkoutUrl: null,
  keyPrefix: "cpk_AAAA",
  webhookUrl: null,
  template: { agents: [], accent: "#112233", chiefName: "Ana" },
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function setup(role: string) {
  const prisma = {
    spaceMember: { findUnique: vi.fn(async () => ({ role, roles: [] })) },
    spaceRole: { findMany: vi.fn(async () => []) },
    space: { findUnique: vi.fn(async () => ({ organizationId: "org-a" })) },
    partnerMember: {
      findMany: vi.fn(async ({ where }: { where: { organizationId: string } }) =>
        where.organizationId === "org-a" ? [{ partner: partnerRow }] : [],
      ),
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { partnerId_organizationId: { partnerId: string; organizationId: string } };
        }) =>
          where.partnerId_organizationId.partnerId === "p-a" &&
          where.partnerId_organizationId.organizationId === "org-a"
            ? { partner: partnerRow }
            : null,
      ),
    },
    partnerTenant: { findMany: vi.fn(async () => []) },
    partnerAuditEvent: { create: vi.fn(async () => ({})) },
    partner: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ template: partnerRow.template })),
    },
    commerceSetting: { findMany: vi.fn(async () => []) },
    mcpServer: { findMany: vi.fn(async () => []) },
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
    },
    dataDir: "/tmp/corvo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(path: string, input?: unknown) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/partnerConsole/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? {} : { json: input }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text).json : undefined };
  }
  return { prisma, call };
}

describe("partnerConsole routes", () => {
  it("is closed to a member without the manage_partner permission", async () => {
    const { call, prisma } = setup("member");
    expect((await call("partners")).status).toBe(403);
    expect((await call("overview", { partnerId: "p-a" })).status).toBe(403);
    expect(prisma.partnerMember.findMany).not.toHaveBeenCalled();
  });

  it("lets an admin list the partners of their organization, with the app's identity for each", async () => {
    const { call } = setup("admin");
    const result = await call("partners");
    expect(result.status).toBe(200);
    expect(result.body).toEqual([
      {
        id: "p-a",
        slug: "slug-a",
        name: "Product A",
        mode: "embedded",
        currency: "BRL",
        accent: "#112233",
        chiefName: "Ana",
      },
    ]);
  });

  it("lets an owner in and answers another organization's partner as not found", async () => {
    const { call } = setup("owner");
    expect((await call("customers", { partnerId: "p-a" })).status).toBe(200);
    expect((await call("customers", { partnerId: "p-of-someone-else" })).status).toBe(404);
    expect((await call("pricing", { partnerId: "p-of-someone-else" })).status).toBe(404);
  });

  it("refuses to change what Rook decides, at the contract", async () => {
    const { call, prisma } = setup("owner");
    const result = await call("setPricing", { partnerId: "p-a", markups: [], commissionBps: 0 });
    expect(result.status).toBe(400);
    expect(prisma.partnerAuditEvent.create).not.toHaveBeenCalled();
  });

  it("reads and saves the template for a member who manages the partner, and not for another", async () => {
    const { call, prisma } = setup("admin");
    expect((await call("template", { partnerId: "p-a" })).body).toEqual({
      template: { agents: [], accent: "#112233", chiefName: "Ana" },
    });
    const saved = await call("setTemplate", { partnerId: "p-a", template: { agents: [] } });
    expect(saved.status).toBe(200);
    expect(prisma.partner.update).toHaveBeenCalledTimes(1);
    expect((await call("setTemplate", { partnerId: "p-b", template: null })).status).toBe(404);
    expect(prisma.partner.update).toHaveBeenCalledTimes(1);
    const refused = setup("member");
    expect((await refused.call("template", { partnerId: "p-a" })).status).toBe(403);
  });
});
