import type { BillingProvider } from "@corvo/adapter-kit";
import type { Actor } from "@corvo/contracts";
import { TERMS_VERSION } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { createBillingService } from "./billing.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
};
const price = { amount: 1000, currency: "usd", interval: "month" as const, intervalCount: 1 };

function service(getPrice: BillingProvider["getPrice"], role = "owner") {
  const prisma = {
    space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
    member: {
      findUnique: vi.fn().mockResolvedValue({ role }),
      count: vi.fn().mockResolvedValue(3),
    },
    billingAccount: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const provider = {
    describe: () => ({ capabilities: { trials: true, portal: true } }),
    getPrice: vi.fn(getPrice),
  } as unknown as BillingProvider;
  return {
    provider,
    billing: createBillingService({ prisma, provider, webOrigin: "https://app.example.com" }),
  };
}

describe("billing status", () => {
  it("reads the price once and reuses it", async () => {
    const { billing, provider } = service(async () => price);
    await expect(billing.status(actor)).resolves.toMatchObject({ price, seats: 3 });
    await billing.status(actor);
    expect(provider.getPrice).toHaveBeenCalledTimes(1);
  });

  it("still answers when the price cannot be read", async () => {
    const { billing } = service(async () => {
      throw new Error("provider unavailable");
    });
    await expect(billing.status(actor)).resolves.toMatchObject({ price: null, access: false });
  });

  it("refuses checkout and portal for non-owners", async () => {
    const { billing } = service(async () => price, "member");
    await expect(billing.checkout(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(billing.portal(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("free trial", () => {
  function seatPlan(trialDays?: number | null) {
    const prisma = {
      space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      member: {
        findUnique: vi.fn().mockResolvedValue({ role: "owner" }),
        count: vi.fn().mockResolvedValue(3),
      },
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({
          organizationId: "org-1",
          customerId: "cus_1",
          status: null,
          subscribedAt: null,
        }),
      },
    } as unknown as PrismaClient;
    const provider = {
      describe: () => ({ capabilities: { trials: true, portal: true } }),
      getPrice: vi.fn(async () => price),
      createCustomer: vi.fn(async () => ({ customerId: "cus_1" })),
      createCheckout: vi.fn(async () => ({ url: "https://pay.example.com" })),
    } as unknown as BillingProvider;
    return {
      provider,
      billing: createBillingService({
        prisma,
        provider,
        webOrigin: "https://app.example.com",
        ...(trialDays === undefined ? {} : { trialDays }),
      }),
    };
  }

  it("is not offered by default", async () => {
    const { billing } = seatPlan();
    await expect(billing.status(actor)).resolves.toMatchObject({
      trialAvailable: false,
      trialDays: 0,
    });
  });

  it("is not sent to checkout by default, so the first charge is immediate", async () => {
    const { billing, provider } = seatPlan();
    await billing.checkout(actor);
    expect(provider.createCheckout).toHaveBeenCalledOnce();
    expect(vi.mocked(provider.createCheckout).mock.calls[0]?.[0]).not.toHaveProperty("trialDays");
  });

  it("asks the provider to collect the current terms version", async () => {
    const { billing, provider } = seatPlan();
    await billing.checkout(actor);
    expect(provider.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ termsVersion: TERMS_VERSION }),
    );
  });

  it("is offered and sent when days are configured", async () => {
    const { billing, provider } = seatPlan(7);
    await expect(billing.status(actor)).resolves.toMatchObject({
      trialAvailable: true,
      trialDays: 7,
    });
    await billing.checkout(actor);
    expect(provider.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ trialDays: 7 }));
  });

  it("is never sent as zero days, which Stripe refuses", async () => {
    const { billing, provider } = seatPlan(0);
    await billing.checkout(actor);
    expect(vi.mocked(provider.createCheckout).mock.calls[0]?.[0]).not.toHaveProperty("trialDays");
  });
});

describe("plan checkout", () => {
  const input = {
    plan: "team" as const,
    interval: "year" as const,
    currency: "brl" as const,
    aiUseCents: null,
  };

  function planService(
    options: {
      role?: string;
      account?: Record<string, unknown> | null;
      people?: number;
      managedModels?: boolean;
    } = {},
  ) {
    const people = options.people ?? 3;
    const lock = vi.fn();
    const tx = { $executeRaw: lock };
    const prisma = {
      space: { findUnique: vi.fn().mockResolvedValue({ organizationId: "org-1" }) },
      member: {
        findUnique: vi.fn().mockResolvedValue({ role: options.role ?? "owner" }),
        count: vi.fn().mockResolvedValue(people),
        findMany: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: people }, (_, i) => ({ user: { email: `p${i}@corvo.test` } })),
          ),
      },
      spaceInvitation: { findMany: vi.fn().mockResolvedValue([]) },
      billingAccount: {
        findUnique: vi.fn().mockResolvedValue(options.account ?? null),
        upsert: vi.fn().mockResolvedValue({
          organizationId: "org-1",
          customerId: "cus_1",
          status: null,
          currency: null,
          subscribedAt: null,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ startedAt: new Date() }]),
      $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
    } as unknown as PrismaClient;
    const provider = {
      describe: () => ({ capabilities: { trials: true, portal: true } }),
      createCustomer: vi.fn(async () => ({ customerId: "cus_1" })),
      createPlanCheckout: vi.fn(async () => ({ url: "https://pay.example.com/plan" })),
      getCustomerSubscription: vi.fn(async () => null),
    } as unknown as BillingProvider;
    return {
      provider,
      lock,
      prisma,
      billing: createBillingService({
        prisma,
        provider,
        webOrigin: "https://app.example.com",
        managedModelsAvailable: options.managedModels,
      }),
    };
  }

  it("lets only the owner open it", async () => {
    const { billing, provider } = planService({ role: "member" });
    await expect(billing.planCheckout(actor, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(provider.createPlanCheckout).not.toHaveBeenCalled();
  });

  it("asks the provider to collect the current terms version", async () => {
    const { billing, provider } = planService({ people: 3 });
    await billing.planCheckout(actor, input);
    expect(provider.createPlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ termsVersion: TERMS_VERSION }),
    );
  });

  it("charges for the people above what the plan includes, never below zero", async () => {
    const small = planService({ people: 3 });
    await small.billing.planCheckout(actor, input);
    expect(small.provider.createPlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "team", currency: "brl", interval: "year", extraPeople: 0 }),
    );
    const eleven = planService({ people: 11 });
    await eleven.billing.planCheckout(actor, input);
    expect(eleven.provider.createPlanCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ extraPeople: 1 }),
    );
  });

  it("refuses a plan that has no room for the people already there", async () => {
    const { billing, provider } = planService({ people: 3 });
    await expect(billing.planCheckout(actor, { ...input, plan: "personal" })).rejects.toMatchObject(
      { code: "PLAN_SEAT_LIMIT" },
    );
    expect(provider.createPlanCheckout).not.toHaveBeenCalled();
  });

  it("refuses a second currency once a plan has been paid in the first", async () => {
    const { billing, provider } = planService({
      account: {
        organizationId: "org-1",
        customerId: "cus_1",
        status: "canceled",
        currency: "usd",
        subscribedAt: new Date(),
      },
    });
    await expect(billing.planCheckout(actor, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(provider.createPlanCheckout).not.toHaveBeenCalled();
    await billing.planCheckout(actor, { ...input, currency: "usd" });
    expect(provider.createPlanCheckout).toHaveBeenCalledOnce();
  });

  it("opens the checkout under the per-organization lock, so two calls open one", async () => {
    const { billing, lock, prisma } = planService();
    await Promise.all([billing.planCheckout(actor, input), billing.planCheckout(actor, input)]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenCalledTimes(2);
  });

  it("answers an already subscribed organization with a conflict, not a second charge", async () => {
    const { billing, provider } = planService({
      account: { organizationId: "org-1", customerId: "cus_1", status: "active", currency: "brl" },
    });
    await expect(billing.planCheckout(actor, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(provider.createPlanCheckout).not.toHaveBeenCalled();
  });

  it("does not sell AI where hosted models are off", async () => {
    const { billing } = planService({ managedModels: false });
    await expect(billing.planCheckout(actor, { ...input, aiUseCents: 1000 })).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" },
    );
  });

  it("reports the plan, currency and interval a subscription is on", async () => {
    const { billing } = planService({
      account: {
        organizationId: "org-1",
        customerId: "cus_1",
        status: "active",
        priceLookupKey: "plan_team_brl_year",
        currency: "brl",
        interval: "year",
      },
    });
    await expect(billing.status(actor)).resolves.toMatchObject({
      plan: "team",
      currency: "brl",
      interval: "year",
    });
  });
});

describe("extra people follow the subscription", () => {
  function seats(account: Record<string, unknown>, people: number) {
    const prisma = {
      member: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: people }, (_, i) => ({ user: { email: `p${i}@corvo.test` } })),
          ),
      },
      spaceInvitation: { findMany: vi.fn().mockResolvedValue([]) },
      organizationLimitOverride: { findUnique: vi.fn().mockResolvedValue(null) },
      billingAccount: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ organizationId: "org-1", customerId: "cus_1", ...account }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(1),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ startedAt: new Date() }]),
    } as unknown as PrismaClient;
    const setExtraSeats = vi.fn(async () => undefined);
    const provider = {
      describe: () => ({ capabilities: {} }),
      getCustomerSubscription: vi.fn(async () => null),
      priceIdForLookupKey: vi.fn(async (key: string) => `price_${key}`),
      getPriceById: vi.fn(async (id: string) => ({
        amount: 1900,
        currency: id.includes("brl") ? "brl" : "usd",
        interval: "year" as const,
        intervalCount: 1,
      })),
      setExtraSeats,
    } as unknown as BillingProvider;
    return {
      setExtraSeats,
      provider,
      billing: createBillingService({ prisma, provider, webOrigin: "https://app.example.com" }),
    };
  }
  const paid = { status: "active", priceId: "price_team" };

  it("bills the eleventh person on the reais yearly price, not a dollar monthly one", async () => {
    vi.stubEnv("PLAN_PRICES", '{"price_team":"team"}');
    const { billing, setExtraSeats } = seats(
      { ...paid, priceLookupKey: "plan_team_brl_year", currency: "brl", interval: "year" },
      11,
    );
    await billing.syncSeats("org-1");
    expect(setExtraSeats).toHaveBeenCalledWith("cus_1", {
      priceId: "price_extra_person_brl_year",
      quantity: 1,
    });
    vi.unstubAllEnvs();
  });

  it("keeps the deployment's extra seat price for a subscription set up by hand", async () => {
    vi.stubEnv("PLAN_PRICES", '{"price_team":"team"}');
    vi.stubEnv("PLAN_LIMITS", '{"team":{"extraSeatPriceId":"price_seat"}}');
    const { billing, setExtraSeats } = seats(paid, 12);
    await billing.syncSeats("org-1");
    expect(setExtraSeats).toHaveBeenCalledWith("cus_1", { priceId: "price_seat", quantity: 2 });
    vi.unstubAllEnvs();
  });

  it("bills no extra person rather than another currency's price when the catalog one is missing", async () => {
    vi.stubEnv("PLAN_PRICES", '{"price_team":"team"}');
    vi.stubEnv("PLAN_LIMITS", '{"team":{"extraSeatPriceId":"price_seat"}}');
    const { billing, setExtraSeats, provider } = seats(
      { ...paid, currency: "brl", interval: "year" },
      12,
    );
    (provider.priceIdForLookupKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await billing.syncSeats("org-1");
    expect(setExtraSeats).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("shows the extra person price in the subscription's currency", async () => {
    const { billing } = seats({ ...paid, currency: "brl", interval: "year" }, 3);
    await expect(billing.extraSeatPriceFor("org-1", "price_seat_usd")).resolves.toMatchObject({
      currency: "brl",
    });
    const hand = seats(paid, 3);
    await expect(hand.billing.extraSeatPriceFor("org-1", "price_seat_usd")).resolves.toMatchObject({
      currency: "usd",
    });
    await expect(hand.billing.extraSeatPriceFor("org-1")).resolves.toBeNull();
  });
});
