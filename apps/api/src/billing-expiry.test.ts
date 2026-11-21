import type { BillingProvider } from "@corvo/adapter-kit";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";

const expire = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  expireModelCredits: expire.run,
  creditAccount: vi.fn(async () => ({
    mode: "credits",
    balanceMicros: 5_000_000n,
  })),
}));

const { createBillingService } = await import("./billing.js");

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
};

function service() {
  const prisma = {
    space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    member: { findUnique: vi.fn().mockResolvedValue({ role: "owner" }) },
    billingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const provider = {
    describe: () => ({ capabilities: { modelCredits: true } }),
  } as unknown as BillingProvider;
  return createBillingService({ prisma, provider, webOrigin: "https://app.example.com" });
}

describe("billing status and credit expiry", () => {
  beforeEach(() => expire.run.mockReset());

  it("waits for expired credit to settle by default", async () => {
    let release: () => void = () => undefined;
    expire.run.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    let answered = false;
    const pending = service()
      .status(actor)
      .then(() => {
        answered = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(answered).toBe(false);
    release();
    await pending;
    expect(answered).toBe(true);
  });

  it("answers a send without queueing behind the account lock, settling expiry after", async () => {
    let release: () => void = () => undefined;
    expire.run.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const status = await service().status(actor, { expiry: "background" });
    expect(status).toMatchObject({ funding: "credits", balanceUsd: 5 });
    expect(expire.run).toHaveBeenCalledOnce();
    release();
  });
});
