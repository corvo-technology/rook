import type { TransactionalEmail } from "@corvo/adapter-kit";
import { BillingEmulator } from "@corvo/adapters";
import type { Actor, PlanCheckoutInput } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { asSystem, billingAccountForOrganization, createDb } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBillingService } from "./billing.js";
import { createBillingNotices } from "./billing-notices.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const DAY = 86_400_000;

describePostgres("subscription emails (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let clock = Date.now();
  const emulator = new BillingEmulator({
    namespace: `billing-emails-${suffix}`,
    modelCredits: true,
    now: () => clock,
  });
  const sent: TransactionalEmail[] = [];
  let failing = false;
  const mailer = {
    describe: () => ({ name: "fake", capabilities: {} }),
    send: async (message: TransactionalEmail) => {
      if (failing) throw new Error("mailer down");
      sent.push(message);
    },
  };
  let prisma: PrismaClient;
  let close: () => Promise<void>;
  let billing: ReturnType<typeof createBillingService>;
  let notices: ReturnType<typeof createBillingNotices>;
  const created = { organizations: [] as string[], users: [] as string[] };
  let counter = 0;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    notices = createBillingNotices({
      prisma,
      email: mailer as never,
      webOrigin: "https://app.example.com",
    });
    billing = createBillingService({
      prisma,
      provider: emulator,
      webOrigin: "https://app.example.com",
      notices,
    });
    await emulator.ensurePlanPrices();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.billingNotice.deleteMany({
      where: { organizationId: { in: created.organizations } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: created.organizations } } });
    await prisma.user.deleteMany({ where: { id: { in: created.users } } });
    await close();
  });

  async function organization(locale?: string, accountLocale?: string) {
    const id = `billing-emails-${suffix}-${++counter}`;
    const spaceId = `${id}-space`;
    const ownerId = `${id}-owner`;
    await prisma.user.create({
      data: {
        id: ownerId,
        name: ownerId,
        email: `${ownerId}@corvo.test`,
        emailVerified: false,
        locale: accountLocale ?? null,
      },
    });
    await prisma.organization.create({ data: { id, name: id, slug: id, createdAt: new Date() } });
    await prisma.space.create({
      data: { id: spaceId, organizationId: id, name: "General", isDefault: true },
    });
    await prisma.member.create({
      data: {
        id: `m-${ownerId}`,
        organizationId: id,
        userId: ownerId,
        role: "owner",
        createdAt: new Date(),
      },
    });
    if (locale)
      await prisma.pushToken.create({
        data: { userId: ownerId, ciphertext: "x", tokenDigest: `d-${id}`, sessionId: "s", locale },
      });
    created.organizations.push(id);
    created.users.push(ownerId);
    const owner: Actor = {
      userId: ownerId,
      spaceId,
      email: `${ownerId}@corvo.test`,
      isDeploymentOwner: false,
    };
    return { id, owner, to: owner.email };
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

  const to = (address: string) => sent.filter((message) => message.to === address);

  it("sends one confirmation when a plan becomes active, however often it is synced again", async () => {
    const { id, owner, to: address } = await organization();
    clock = Date.now();
    const customerId = await subscribe(owner, id, input({ aiUseCents: 1000 }));
    await Promise.all([
      billing.sync(customerId),
      billing.sync(customerId),
      billing.syncForActor(owner),
    ]);
    await billing.sync(customerId);
    expect(to(address)).toHaveLength(1);
    const [message] = to(address);
    expect(message?.subject).toBe("Your Team plan is active");
    expect(message?.text).toContain("Charged: $51.00");
    expect(message?.text).toContain("Next renewal:");
    expect(message?.text).toContain("AI: $10.00 of use each month");
  });

  it("sends in the owner's app language and the subscription's currency", async () => {
    const { id, owner, to: address } = await organization("pt-BR");
    clock = Date.now();
    await subscribe(owner, id, input({ currency: "brl", interval: "year" }));
    const [message] = to(address);
    expect(message?.subject).toBe("Seu plano Equipe está ativo");
    expect(message?.text).toMatch(/Cobrado: R\$\s2\.359,00/);
  });

  it("prefers the account language over the device's, and links the site's terms", async () => {
    const { id, owner, to: address } = await organization("pt-BR", "es");
    clock = Date.now();
    await subscribe(owner, id, input());
    const [message] = to(address);
    expect(message?.subject).toBe("Tu plan Equipo está activo");
    expect(message?.text).toContain("Términos: https://rook.team/terms");
  });

  it("sends another when a change takes effect, and one for each", async () => {
    const { id, owner, to: address } = await organization();
    clock = Date.now();
    await subscribe(owner, id, input({ plan: "company" }));
    clock += 10 * DAY;
    await billing.changePlan(owner, input({ plan: "company", aiUseCents: 1000 }));
    await billing.syncForActor(owner);
    expect(to(address).map((message) => message.subject)).toEqual([
      "Your Company plan is active",
      "Your plan is now Company",
    ]);
    expect(to(address)[1]?.text).not.toContain("Charged");
    // A downgrade waits for the renewal: nothing yet, then one email when it applies.
    await billing.changePlan(owner, input({ plan: "team", aiUseCents: 1000 }));
    expect(to(address)).toHaveLength(2);
    clock += 25 * DAY;
    await billing.syncForActor(owner);
    await billing.syncForActor(owner);
    expect(to(address)).toHaveLength(3);
    expect(to(address)[2]?.subject).toBe("Your plan is now Team");
    expect(to(address)[2]?.text).toContain("Charged:");
  });

  it("never fails the sync when the mailer is down", async () => {
    const { id, owner, to: address } = await organization();
    clock = Date.now();
    failing = true;
    try {
      await expect(subscribe(owner, id, input())).resolves.toBeTruthy();
    } finally {
      failing = false;
    }
    expect(to(address)).toHaveLength(0);
  });

  describe("renewal reminder", () => {
    /**
     * Runs the daily job as it would run `days` before the account's renewal, and says how many
     * emails the owner got from it; other tests' accounts in the same database are reminded too.
     */
    async function remindBefore(organizationId: string, days: number) {
      const account = await billingAccountForOrganization(prisma, organizationId);
      const owner = `${organizationId}-owner@corvo.test`;
      const before = to(owner).length;
      await notices.remindRenewals(new Date(account!.currentPeriodEndsAt!.getTime() - days * DAY));
      return to(owner).length - before;
    }

    it("reminds a yearly plan at 30 and at 7 days, once each", async () => {
      const { id, owner, to: address } = await organization("pt-BR");
      clock = Date.now();
      await subscribe(owner, id, input({ currency: "brl", interval: "year", aiUseCents: 1000 }));
      const confirmations = to(address).length;
      expect(await remindBefore(id, 31)).toBe(0);
      expect(await remindBefore(id, 30)).toBe(1);
      expect(await remindBefore(id, 30)).toBe(0);
      expect(await remindBefore(id, 12)).toBe(0);
      expect(await remindBefore(id, 7)).toBe(1);
      expect(await remindBefore(id, 7)).toBe(0);
      expect(await remindBefore(id, 1)).toBe(0);
      const reminders = to(address).slice(confirmations);
      expect(reminders).toHaveLength(2);
      const account = await billingAccountForOrganization(prisma, id);
      const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(
        account!.currentPeriodEndsAt!,
      );
      for (const message of reminders) {
        expect(message.subject).toBe(`Seu plano anual renova em ${date}`);
        // Team for a year in reais, plus the AI add-on's twelve months.
        expect(message.text).toMatch(/serão cobrados pelo plano Equipe/);
        expect(message.text).toMatch(/R\$\s3\.221,80/);
        expect(message.text).toContain("cancele antes dessa data");
      }
    });

    it("sends only the 7 day reminder when the first run comes late", async () => {
      const { id, owner, to: address } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input({ interval: "year" }));
      const confirmations = to(address).length;
      expect(await remindBefore(id, 5)).toBe(1);
      expect(await remindBefore(id, 4)).toBe(0);
      expect(to(address)).toHaveLength(confirmations + 1);
    });

    it("never reminds a monthly plan", async () => {
      const { id, owner, to: address } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input({ interval: "month" }));
      const confirmations = to(address).length;
      for (const days of [30, 7, 3]) expect(await remindBefore(id, days)).toBe(0);
      expect(to(address)).toHaveLength(confirmations);
    });

    it("skips a plan set to cancel", async () => {
      const { id, owner, to: address } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input({ interval: "year" }));
      const confirmations = to(address).length;
      await prisma.billingAccount.update({
        where: { organizationId: id },
        data: { cancelAtPeriodEnd: true },
      });
      expect(await remindBefore(id, 30)).toBe(0);
      expect(await remindBefore(id, 7)).toBe(0);
      expect(to(address)).toHaveLength(confirmations);
    });

    it("gives the claim back when the mailer is down, so the next run sends", async () => {
      const { id, owner, to: address } = await organization();
      clock = Date.now();
      await subscribe(owner, id, input({ interval: "year" }));
      const confirmations = to(address).length;
      failing = true;
      try {
        expect(await remindBefore(id, 30)).toBe(0);
      } finally {
        failing = false;
      }
      expect(await remindBefore(id, 29)).toBe(1);
      expect(to(address)).toHaveLength(confirmations + 1);
    });
  });
});
