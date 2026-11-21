import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { RPCHandler } from "@orpc/server/fetch";
import { describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor = {
  spaceId: "space-current",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

type TargetSpace = {
  organizationId: string;
  role: string;
  deletingAt: Date | null;
} | null;

function avatarHarness(target: TargetSpace, currentOrganizationId: string | null = "org-1") {
  const update = vi.fn(async () => ({ id: "space-target" }));
  const tx = {
    $queryRaw: vi.fn(async () => []),
    spaceMember: {
      findUnique: vi.fn(async (args: { where: { spaceId_userId: { spaceId: string } } }) => {
        const spaceId = args.where.spaceId_userId.spaceId;
        if (spaceId === actor.spaceId) {
          return currentOrganizationId ? { organizationId: currentOrganizationId } : null;
        }
        if (!target) return null;
        return {
          organizationId: target.organizationId,
          role: target.role,
          space: { isDefault: false, deletingAt: target.deletingAt },
        };
      }),
    },
    spaceRole: { findMany: vi.fn(async () => []) },
    space: { update },
  };
  const transaction = vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
  const prisma = {
    $transaction: transaction,
    // The router checks membership before scoping the database to the target Space.
    spaceMember: {
      findFirst: vi.fn(async (args: { where: { spaceId: string } }) =>
        tx.spaceMember.findUnique({ where: { spaceId_userId: { spaceId: args.where.spaceId } } }),
      ),
    },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/corvo-space-rename-test",
  } as unknown as RouterDeps;
  return { update, transaction, handler: new RPCHandler(createRouter(deps)) };
}

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function avatarRequest(avatar: string | null, spaceId = "space-target") {
  return new Request("http://127.0.0.1/rpc/spaces/setAvatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { spaceId, avatar } }),
  });
}

async function send(
  harness: ReturnType<typeof avatarHarness>,
  avatar: string | null,
  spaceId?: string,
) {
  const { response } = await harness.handler.handle(avatarRequest(avatar, spaceId), {
    prefix: "/rpc",
    context: { actor },
  });
  return response;
}

describe("spaces.setAvatar", () => {
  it.each(["owner", "admin"])("lets a space %s set a color", async (role) => {
    const harness = avatarHarness({ organizationId: "org-1", role, deletingAt: null });
    const response = await send(harness, "#15803D");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      json: { id: "space-target", logo: "#15803D" },
    });
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: "space-target" },
      data: { logo: "#15803D" },
    });
  });

  it("stores a picture re-encoded as webp, never as sent", async () => {
    const harness = avatarHarness({ organizationId: "org-1", role: "owner", deletingAt: null });
    expect((await send(harness, PNG)).status).toBe(200);
    const call = harness.update.mock.calls[0] as unknown as [{ data: { logo: string } }];
    expect(call[0].data.logo.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("clears the avatar with null", async () => {
    const harness = avatarHarness({ organizationId: "org-1", role: "owner", deletingAt: null });
    expect((await send(harness, null)).status).toBe(200);
    expect(harness.update).toHaveBeenCalledWith({
      where: { id: "space-target" },
      data: { logo: null },
    });
  });

  it("refuses a plain member", async () => {
    const harness = avatarHarness({ organizationId: "org-1", role: "member", deletingAt: null });
    expect((await send(harness, "#15803D")).status).toBe(403);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it("refuses someone who is not in the space", async () => {
    const harness = avatarHarness(null);
    expect((await send(harness, "#15803D")).status).toBe(404);
    expect(harness.update).not.toHaveBeenCalled();
  });

  it.each([
    "http://tracker.example/pixel.gif",
    "https://example.com/logo.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "not a color",
  ])("refuses %s before touching the space", async (value) => {
    const harness = avatarHarness({ organizationId: "org-1", role: "owner", deletingAt: null });
    expect((await send(harness, value)).status).toBeGreaterThanOrEqual(400);
    expect(harness.transaction).not.toHaveBeenCalled();
  });

  it("refuses while the space is being deleted", async () => {
    const harness = avatarHarness({
      organizationId: "org-1",
      role: "owner",
      deletingAt: new Date(),
    });
    expect((await send(harness, "#15803D")).status).toBe(409);
    expect(harness.update).not.toHaveBeenCalled();
  });
});
