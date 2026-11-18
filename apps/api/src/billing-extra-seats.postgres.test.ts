import { randomUUID } from "node:crypto";
import type { BillingProvider, BillingSubscriptionSnapshot } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, provisionMessagingIdentity, runAsSystem } from "@corvo/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createBillingService } from "./billing.js";

const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

describePostgres("extra seats on the subscription (PostgreSQL)", () => {
  const address = `extra-seats-${randomUUID()}@corvo.test`;
  let db: ReturnType<typeof createDb>;
  let system: PrismaClient;
  let owner: { userId: string; spaceId: string };
  const snapshot: BillingSubscriptionSnapshot = {
    subscriptionId: "sub_1",
    subscriptionItemId: "si_1",
    priceId: "price_team",
    status: "active",
    seats: 1,
    trialEndsAt: null,
    currentPeriodEndsAt: new Date("2026-12-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    endedAt: null,
  };
  const setExtraSeats = vi.fn(async () => undefined);
  const updateSeats = vi.fn(async () => undefined);
  const provider = {
    describe: () => ({ capabilities: {} }),
    getCustomerSubscription: async () => snapshot,
    getPriceById: vi.fn(async () => ({
      amount: 500,
      currency: "usd",
      interval: "month" as const,
      intervalCount: 1,
    })),
    setExtraSeats,
    updateSeats,
  } as unknown as BillingProvider;

  beforeAll(async () => {
    db = createDb(url!);
    system = asSystem(db.prisma, "extra seats fixture");
    owner = await runAsSystem("extra seats fixture", () =>
      provisionMessagingIdentity(
        db.prisma,
        { provider: "email", address },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    await system.billingAccount.create({
      data: {
        organizationId: owner.spaceId,
        customerId: `cus_${randomUUID()}`,
        priceId: "price_team",
        status: "active",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (owner) {
      await system.messagingIdentity.deleteMany({ where: { address } });
      await system.organization.deleteMany({ where: { id: owner.spaceId } });
      await system.user.deleteMany({ where: { id: owner.userId } });
    }
    if (db) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  const service = () =>
    createBillingService({ prisma: system, provider, webOrigin: "https://app.example.com" });
  const invite = async (count: number) => {
    for (let index = 0; index < count; index += 1)
      await system.spaceInvitation.create({
        data: {
          id: randomUUID(),
          spaceId: owner.spaceId,
          email: `seat-${randomUUID()}@corvo.test`,
          expiresAt: new Date(Date.now() + 86_400_000),
          inviterId: owner.userId,
        },
      });
  };

  it("bills only the seats above the included ones, on the extra seat price", async () => {
    vi.stubEnv("PLAN_PRICES", '{"price_team":"team"}');
    vi.stubEnv(
      "PLAN_LIMITS",
      '{"team":{"seatsIncluded":2,"maxSeats":10,"extraSeatPriceId":"price_seat"}}',
    );
    // The owner plus one invite fit the two included seats.
    await invite(1);
    await service().syncSeats(owner.spaceId);
    expect(setExtraSeats).toHaveBeenLastCalledWith(expect.any(String), {
      priceId: "price_seat",
      quantity: 0,
    });
    // Two more people make four: two seats above the included ones.
    await invite(2);
    await service().syncSeats(owner.spaceId);
    expect(setExtraSeats).toHaveBeenLastCalledWith(expect.any(String), {
      priceId: "price_seat",
      quantity: 2,
    });
    // The plan's own line is never scaled by head count under plans.
    expect(updateSeats).not.toHaveBeenCalled();
  });

  it("bills nothing extra where no extra seat price is configured", async () => {
    vi.stubEnv("PLAN_PRICES", '{"price_team":"team"}');
    await service().syncSeats(owner.spaceId);
    expect(setExtraSeats).not.toHaveBeenCalled();
    expect(updateSeats).not.toHaveBeenCalled();
  });

  it("looks up the extra seat price once for display", async () => {
    const billing = service();
    expect(await billing.extraSeatPrice("price_seat")).toMatchObject({ amount: 500 });
    await billing.extraSeatPrice("price_seat");
    expect(provider.getPriceById).toHaveBeenCalledTimes(1);
  });
});
