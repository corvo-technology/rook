import { BillingEmulator } from "@corvo/adapters";
import type { Actor, PlanCheckoutInput } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  billingAccountForOrganization,
  createBillingAccount,
  createDb,
  reconcileCreditPurchase,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBillingService } from "./billing.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const DAY = 86_400_000;

describePostgres("plan changes (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const start = Date.now();
  let clock = start;
  const emulator = new BillingEmulator({
    namespace: `plan-change-${suffix}`,
    modelCredits: true,
    now: () => clock,
  });
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let billing: ReturnType<typeof createBillingService>;
  const created = { organizations: [] as string[], users: [] as string[] };
  let counter = 0;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    billing = createBillingService({
      prisma,
      provider: emulator,
      webOrigin: "https://app.example.com",
    });
    await emulator.ensurePlanPrices();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: created.organizations } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await close();
  });

  /** A fresh organization with its owner and `extraMembers` more people. */
  async function organization(extraMembers = 0) {
    const n = ++counter;
    const id = `plan-change-${suffix}-${n}`;
    const spaceId = `${id}-space`;
    const ownerId = `${id}-owner`;
    const ids = [ownerId, ...Array.from({ length: extraMembers }, (_, i) => `${id}-member-${i}`)];
    for (const userId of ids)
      await prisma.user.create({
        data: { id: userId, name: userId, email: `${userId}@corvo.test`, emailVerified: false },
      });
    await prisma.organization.create({
      data: { id, name: id, slug: id, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id: spaceId, organizationId: id, name: "General", isDefault: true },
    });
    for (const [i, userId] of ids.entries())
      await prisma.member.create({
        data: {
          id: `m-${userId}`,
          organizationId: id,
          userId,
          role: i === 0 ? "owner" : "member",
          createdAt: new Date(),
        },
      });
    created.organizations.push(id);
    created.users.push(...ids);
    const actor = (userId: string): Actor => ({
      userId,
      spaceId,
      email: `${userId}@corvo.test`,
      isDeploymentOwner: false,
    });
    return { id, owner: actor(ownerId), member: actor(ids[1] ?? ownerId) };
  }

  const input = (overrides: Partial<PlanCheckoutInput> = {}): PlanCheckoutInput => ({
    plan: "team",
    interval: "month",
    currency: "usd",
    aiUseCents: null,
    ...overrides,
  });

  async function subscribe(owner: Actor, organizationId: string, choice: PlanCheckoutInput) {
    await billing.planCheckout(owner, choice);
    const account = await billingAccountForOrganization(prisma, organizationId);
    emulator.completePlanCheckout(account!.customerId);
    await billing.syncForActor(owner);
    return account!.customerId;
  }

  async function balance(owner: Actor) {
    return (await billing.status(owner)).balanceUsd;
  }

  it("opens a plan checkout when the saved customer no longer exists at the provider", async () => {
    const { id, owner } = await organization();
    const gone = `cus_gone_${id}`;
    await createBillingAccount(prisma, { organizationId: id, customerId: gone });
    await expect(billing.planCheckout(owner, input())).resolves.toMatchObject({
      url: expect.stringContaining("/plan/"),
    });
    const account = await billingAccountForOrganization(prisma, id);
    expect(account?.customerId).not.toBe(gone);
  });

  it("applies a bigger plan and more AI now, and grants the use that was charged for", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    await subscribe(owner, id, input());
    // Half the period is left, so half of the extra 10 dollars of use is charged and granted.
    clock += 15 * DAY;
    await expect(
      billing.changePlan(owner, input({ plan: "company", aiUseCents: 1000 })),
    ).resolves.toEqual({ ok: true });
    const status = await billing.status(owner);
    expect(status).toMatchObject({ plan: "company", aiUseCents: 1000, balanceUsd: 5 });
    expect(status.pendingChange).toBeUndefined();
  });

  it("grants once however often the change is read again or in what order", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    const customerId = await subscribe(owner, id, input({ aiUseCents: 1000 }));
    expect(await balance(owner)).toBe(10);
    clock += 15 * DAY;
    await billing.changePlan(owner, input({ aiUseCents: 2000 }));
    expect(await balance(owner)).toBe(15);
    const body = {
      type: "invoice.paid",
      data: { object: { object: "invoice", customer: customerId } },
    };
    await Promise.all([
      billing.sync(customerId),
      billing.sync(customerId),
      billing.syncForActor(owner),
    ]);
    const signed = emulator.signWebhook(body);
    expect(emulator.parseWebhook(signed.body, signed.headers)).toEqual({ customerId });
    await billing.sync(customerId);
    await billing.sync(customerId);
    expect(await balance(owner)).toBe(15);
  });

  it("keeps the current plan until renewal for a downgrade, then moves", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    await subscribe(owner, id, input({ plan: "company", aiUseCents: 2000 }));
    expect(await balance(owner)).toBe(20);
    clock += 10 * DAY;
    await billing.changePlan(owner, input({ plan: "team", aiUseCents: 1000 }));
    const waiting = await billing.status(owner);
    expect(waiting).toMatchObject({
      plan: "company",
      aiUseCents: 2000,
      pendingChange: { plan: "team", interval: "month", aiUseCents: 1000 },
    });
    expect(waiting.pendingChange?.effectiveAt).toBe(waiting.currentPeriodEndsAt);
    expect(await balance(owner)).toBe(20);
    clock += 21 * DAY;
    await billing.syncForActor(owner);
    const renewed = await billing.status(owner);
    expect(renewed).toMatchObject({ plan: "team", aiUseCents: 1000 });
    expect(renewed.pendingChange).toBeUndefined();
    // The new period's use is granted once, whatever is synced after.
    await billing.syncForActor(owner);
    expect(await balance(owner)).toBe(30);
  });

  it("splits a move that grows one part and shrinks another", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    await subscribe(owner, id, input({ aiUseCents: 5000 }));
    await billing.changePlan(owner, input({ plan: "company", aiUseCents: 1000 }));
    await expect(billing.status(owner)).resolves.toMatchObject({
      plan: "company",
      aiUseCents: 5000,
      pendingChange: { plan: "company", interval: "month", aiUseCents: 1000 },
    });
  });

  it("replaces a waiting downgrade, and clears it when the owner goes back", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    await subscribe(owner, id, input({ plan: "company" }));
    await billing.changePlan(owner, input({ plan: "team" }));
    await billing.changePlan(owner, input({ plan: "personal" }));
    await expect(billing.status(owner)).resolves.toMatchObject({
      plan: "company",
      pendingChange: { plan: "personal" },
    });
    await billing.changePlan(owner, input({ plan: "company" }));
    const status = await billing.status(owner);
    expect(status.plan).toBe("company");
    expect(status.pendingChange).toBeUndefined();
    const account = await billingAccountForOrganization(prisma, id);
    expect(account?.pendingPlanKey).toBeNull();
  });

  it("refuses a plan too small for the people already there", async () => {
    const { id, owner } = await organization(2);
    await subscribe(owner, id, input({ plan: "company" }));
    await expect(billing.changePlan(owner, input({ plan: "personal" }))).rejects.toMatchObject({
      code: "PLAN_SEAT_LIMIT",
    });
    await expect(billing.status(owner)).resolves.toMatchObject({ plan: "company" });
  });

  it("never changes the currency after the first payment", async () => {
    const { id, owner } = await organization();
    await subscribe(owner, id, input({ currency: "brl" }));
    await expect(
      billing.changePlan(owner, input({ currency: "usd", plan: "company" })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await billing.changePlan(owner, input({ currency: "brl", plan: "company" }));
    await expect(billing.status(owner)).resolves.toMatchObject({
      plan: "company",
      currency: "brl",
    });
  });

  it("moves an own-key subscriber to a plan and keeps the balance", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    const { customerId } = await emulator.createCustomer({
      email: owner.email,
      organizationId: id,
    });
    await createBillingAccount(prisma, { organizationId: id, customerId });
    await reconcileCreditPurchase(prisma, id, { id: `legacy-topup-${id}`, amountCents: 2500 });
    await emulator.createByokCheckout({
      customerId,
      amountCents: 1000,
      successUrl: "https://app.example.com/ok",
      cancelUrl: "https://app.example.com/no",
    });
    emulator.completeByokCheckout(customerId);
    await billing.syncForActor(owner);
    await expect(billing.status(owner)).resolves.toMatchObject({ access: true, balanceUsd: 25 });

    await billing.changePlan(owner, input({ aiUseCents: 1000 }));
    const status = await billing.status(owner);
    expect(status).toMatchObject({ plan: "team", aiUseCents: 1000 });
    expect(status.pendingChange).toBeUndefined();
    // The old balance stays, and the plan's use is added to it, never replacing it.
    expect(status.balanceUsd).toBe(35);
    const subscription = await emulator.getCustomerSubscription(customerId);
    expect(subscription?.byokPlan).toBeUndefined();
  });

  it("moves a monthly credit subscriber to a plan and keeps the balance", async () => {
    const { id, owner } = await organization();
    clock = Date.now();
    await billing.purchaseCredits(owner, { amountCents: 2000, monthly: true });
    const account = await billingAccountForOrganization(prisma, id);
    emulator.completeCreditCheckout(account!.customerId);
    await billing.syncForActor(owner);
    await expect(billing.status(owner)).resolves.toMatchObject({
      monthlyAmountCents: 2000,
      balanceUsd: 20,
    });

    await billing.changePlan(owner, input());
    const status = await billing.status(owner);
    expect(status).toMatchObject({ plan: "team", balanceUsd: 20 });
    expect(status.monthlyAmountCents).toBeNull();
    // Dollars only: the legacy subscription had none in reais.
    await expect(billing.changePlan(owner, input({ currency: "brl" }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses a legacy subscriber a plan in reais", async () => {
    const { id, owner } = await organization();
    const { customerId } = await emulator.createCustomer({
      email: owner.email,
      organizationId: id,
    });
    await createBillingAccount(prisma, { organizationId: id, customerId });
    await emulator.createByokCheckout({
      customerId,
      amountCents: 1000,
      successUrl: "https://app.example.com/ok",
      cancelUrl: "https://app.example.com/no",
    });
    emulator.completeByokCheckout(customerId);
    await expect(billing.changePlan(owner, input({ currency: "brl" }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("changes nothing and sends the owner to the portal when the payment fails", async () => {
    const { id, owner } = await organization();
    await subscribe(owner, id, input());
    emulator.failNextPlanChange = true;
    const result = await billing.changePlan(owner, input({ plan: "company" }));
    expect(result.url).toContain("portal");
    await expect(billing.status(owner)).resolves.toMatchObject({ plan: "team" });
  });

  it("is for the owner only, and needs a subscription", async () => {
    const { id, owner, member } = await organization(1);
    await expect(billing.changePlan(owner, input())).rejects.toMatchObject({ code: "CONFLICT" });
    await subscribe(owner, id, input());
    await expect(billing.changePlan(member, input({ plan: "company" }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  describe("funding follows the AI add-on", () => {
    const funding = async (organizationId: string) =>
      (await prisma.modelCreditAccount.findUnique({ where: { organizationId } }))?.mode;
    const setFunding = (organizationId: string, mode: "byok" | "credits") =>
      prisma.modelCreditAccount.upsert({
        where: { organizationId },
        create: { organizationId, mode },
        update: { mode },
      });

    it("switches to credits when a plan is bought with AI", async () => {
      const { id, owner } = await organization();
      await setFunding(id, "byok");
      await subscribe(owner, id, input({ aiUseCents: 1000 }));
      expect(await funding(id)).toBe("credits");
      expect(await balance(owner)).toBe(10);
    });

    it("switches to credits when an upgrade adds AI, keeping the balance", async () => {
      const { id, owner } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input());
      await reconcileCreditPurchase(prisma, id, { id: `topup-${id}`, amountCents: 700 });
      await setFunding(id, "byok");
      await billing.changePlan(owner, input({ aiUseCents: 1000 }));
      expect(await funding(id)).toBe("credits");
      expect(await balance(owner)).toBe(17);
    });

    it("goes back to its own AI only when the removal takes effect at renewal", async () => {
      const { id, owner } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input({ aiUseCents: 1000 }));
      expect(await funding(id)).toBe("credits");
      await billing.changePlan(owner, input());
      expect(await funding(id)).toBe("credits");
      clock += 31 * DAY;
      await billing.syncForActor(owner);
      expect(await funding(id)).toBe("byok");
      // The credit that was paid for stays.
      expect(await balance(owner)).toBe(10);
    });

    it("switches once: a repeated sync leaves a later choice alone", async () => {
      const { id, owner } = await organization();
      clock = Date.now();
      const customerId = await subscribe(owner, id, input({ aiUseCents: 1000 }));
      await billing.changePlan(owner, input());
      clock += 31 * DAY;
      await Promise.all([billing.sync(customerId), billing.sync(customerId)]);
      expect(await funding(id)).toBe("byok");
      await setFunding(id, "credits");
      await billing.sync(customerId);
      await billing.sync(customerId);
      expect(await funding(id)).toBe("credits");
      expect(await balance(owner)).toBe(10);
    });
  });
});
