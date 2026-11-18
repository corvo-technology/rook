import type { PartnerPricingConfig } from "@corvo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { holdCredits, reconcileCreditGrantMicros } from "./model-credits.js";
import {
  assertPartnerSpendAllowed,
  claimAutoTopups,
  claimPartnerCreditNotices,
  debitPartnerResource,
  failAutoTopup,
  PartnerSpendRefused,
  renewPartnerPlans,
  setPartnerPlan,
} from "./partner-credit-enforcement.js";

vi.mock("./partner-wallet.js", () => ({ partnerWalletOrganization: async () => "wallet-org" }));
vi.mock("./model-credits.js", () => ({
  holdCredits: vi.fn(async () => "held"),
  reconcileCreditGrantMicros: vi.fn(async () => 0n),
}));

const CREDIT = 10_000n;
const NOW = new Date("2026-11-18T12:00:00Z");

// Test numbers only.
const CONFIG: PartnerPricingConfig = {
  tiers: [
    {
      key: "pro",
      name: "Pro",
      prices: {
        BRL: { priceMinor: 49_900, includedCredits: 20_000 },
        USD: { priceMinor: 9_900, includedCredits: 20_000 },
      },
    },
  ],
  costs: {
    models: {},
    voiceMinuteMicros: 20_000,
    computerMinuteMicros: 1_000,
    storageGbMonthMicros: 50_000,
  },
  margins: { tokensBps: 0, perModelBps: {}, voiceBps: 0, computerMinuteBps: 0, storageBps: 0 },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: null,
  lowBalanceBps: 2000,
};

interface World {
  limit: number | null;
  allowed: string[];
  mode: string;
  spent: bigint;
  balance: bigint;
  /** What the fund was filled with, and the id of the last refill. */
  refill: { id: string; amount: bigint };
  autoTopup: { enabled: boolean; threshold: number; amountMinor: number };
  webhookUrl: string | null;
}

type Row = Record<string, any>;

const NOW_REF = { value: NOW };

function world(overrides: Partial<World> = {}) {
  const state: World = {
    limit: 100,
    allowed: [],
    mode: "embedded",
    spent: 0n,
    balance: 10_000n * CREDIT,
    refill: { id: "refill-1", amount: 10_000n * CREDIT },
    autoTopup: { enabled: true, threshold: 500, amountMinor: 5000 },
    webhookUrl: "https://partner.example/hook",
    ...overrides,
  };
  const events: Row[] = [];
  const attempts: Row[] = [];
  const invoices: Row[] = [];
  const lines: Row[] = [];
  let plan: Row | null = null;
  const unique = () => Object.assign(new Error("unique"), { code: "P2002" });
  const prisma = {
    partnerTenant: {
      findUnique: async () => ({
        creditLimitCredits: state.limit,
        partner: { creditAllowedModels: state.allowed, mode: state.mode },
      }),
      findMany: async () => [
        { externalTenantId: "ext-1", organizationId: "org-1", creditLimitCredits: state.limit },
      ],
    },
    modelCreditEntry: {
      aggregate: async ({ where }: { where: { amountMicros: { lt?: bigint } } }) =>
        where.amountMicros.lt !== undefined
          ? { _sum: { amountMicros: -state.spent } }
          : { _sum: { amountMicros: state.refill.amount } },
      findFirst: async () => ({ id: state.refill.id, amountMicros: state.refill.amount }),
    },
    modelCreditAccount: { findUnique: async () => ({ balanceMicros: state.balance }) },
    partner: {
      findMany: async () => [
        {
          id: "partner-1",
          webhookUrl: state.webhookUrl,
          currency: "BRL",
          autoTopupThresholdCredits: state.autoTopup.threshold,
          autoTopupAmountMinor: state.autoTopup.amountMinor,
        },
      ],
      findUniqueOrThrow: async () => ({ currency: "BRL" }),
    },
    partnerPricingVersion: {
      findFirst: async () => ({ version: 3, config: CONFIG, createdAt: NOW }),
    },
    partnerWebhookEvent: {
      create: async ({ data }: { data: Row }) => {
        const same = events.some(
          (event) =>
            event.partnerId === data.partnerId &&
            event.externalTenantId === data.externalTenantId &&
            event.kind === data.kind &&
            event.period === data.period,
        );
        if (same) throw unique();
        events.push(data);
        return { id: `event-${events.length}` };
      },
    },
    partnerAutoTopupAttempt: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; partnerId_crossingKey?: { crossingKey: string } };
      }) =>
        attempts.find(
          (row) =>
            row.crossingKey === where.partnerId_crossingKey?.crossingKey || row.id === where.id,
        ) ?? null,
      create: async ({ data }: { data: Row }) => {
        const row = { id: `attempt-${attempts.length + 1}`, ...data };
        attempts.push(row);
        return row;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = attempts.find((candidate) => candidate.id === where.id);
        if (!row || row.state !== where.state || row.attempts !== where.attempts) {
          return { count: 0 };
        }
        Object.assign(row, data);
        return { count: 1 };
      },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => {
        Object.assign(attempts.find((row) => row.id === where.id) as Row, data);
      },
    },
    partnerPlan: {
      upsert: async ({ create }: { create: Row }) => {
        plan = { ...create };
        return plan;
      },
      findMany: async () =>
        plan && plan.status === "active" && plan.periodEnd <= NOW_REF.value ? [plan] : [],
      update: async ({ data }: { data: Row }) => {
        Object.assign(plan as Row, data);
      },
      updateMany: async ({ data }: { data: Row }) => {
        Object.assign(plan as Row, data);
      },
    },
    partnerInvoice: {
      upsert: async ({ create }: { create: Row }) => {
        let invoice = invoices.find((row) => row.period === create.period);
        if (!invoice) {
          invoice = { id: `inv-${invoices.length + 1}`, state: "draft", ...create };
          invoices.push(invoice);
        }
        return invoice;
      },
      update: async ({ data }: { data: Row }) => {
        Object.assign(invoices[0] as Row, data);
      },
    },
    partnerInvoiceLine: {
      createMany: async ({ data }: { data: Row[] }) => {
        for (const line of data) {
          if (!lines.some((row) => row.entryId === line.entryId)) lines.push(line);
        }
      },
      aggregate: async () => ({
        _sum: { rookShareMinor: lines.reduce((sum, line) => sum + line.rookShareMinor, 0) },
      }),
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    state,
    events,
    attempts,
    invoices,
    lines,
    plan: () => plan,
  };
}

beforeEach(() => {
  vi.mocked(holdCredits).mockClear();
  vi.mocked(reconcileCreditGrantMicros).mockClear();
  NOW_REF.value = NOW;
});

describe("the customer's monthly credit limit", () => {
  it("lets a customer under its limit through", async () => {
    const { prisma } = world({ spent: 99n * CREDIT });
    await expect(
      assertPartnerSpendAllowed(prisma, "org-1", { model: "m" }, NOW),
    ).resolves.toBeUndefined();
  });
  it("refuses once the customer has reached its limit", async () => {
    const { prisma } = world({ spent: 100n * CREDIT });
    await expect(
      assertPartnerSpendAllowed(prisma, "org-1", { model: "m" }, NOW),
    ).rejects.toMatchObject({ reason: "credit_limit_reached" });
  });
  it("never blocks a customer with no limit", async () => {
    const { prisma } = world({ limit: null, spent: 1_000_000n * CREDIT });
    await expect(
      assertPartnerSpendAllowed(prisma, "org-1", { model: "m" }, NOW),
    ).resolves.toBeUndefined();
  });
  it("leaves an organization that belongs to no embedded partner alone", async () => {
    const { prisma } = world({ mode: "white_label", spent: 1_000_000n * CREDIT });
    await expect(
      assertPartnerSpendAllowed(prisma, "org-1", { model: "m" }, NOW),
    ).resolves.toBeUndefined();
  });
});

describe("the partner's allowed models", () => {
  it("refuses a Rook-provided model outside the list", async () => {
    const { prisma } = world({ allowed: ["model-a"], limit: null });
    const refusal = assertPartnerSpendAllowed(
      prisma,
      "org-1",
      { provider: "p", model: "model-b" },
      NOW,
    );
    await expect(refusal).rejects.toBeInstanceOf(PartnerSpendRefused);
    await expect(refusal).rejects.toMatchObject({ reason: "model_not_allowed" });
  });
  it("allows a listed model and, with an empty list, any model", async () => {
    const listed = world({ allowed: ["model-a"], limit: null });
    await expect(
      assertPartnerSpendAllowed(listed.prisma, "org-1", { provider: "p", model: "model-a" }, NOW),
    ).resolves.toBeUndefined();
    const open = world({ allowed: [], limit: null });
    await expect(
      assertPartnerSpendAllowed(open.prisma, "org-1", { provider: "p", model: "anything" }, NOW),
    ).resolves.toBeUndefined();
  });
});

describe("webhooks", () => {
  it("sends the limit notice once per customer and period", async () => {
    const { prisma, events } = world({ spent: 100n * CREDIT, balance: 9_000n * CREDIT });
    expect(await claimPartnerCreditNotices(prisma, NOW)).toEqual(["event-1"]);
    expect(await claimPartnerCreditNotices(prisma, NOW)).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "customer.credit_limit_reached",
      externalTenantId: "ext-1",
      period: "2026-11",
    });
    // The next month it can be sent again.
    expect(await claimPartnerCreditNotices(prisma, new Date("2026-12-02T00:00:00Z"))).toHaveLength(
      1,
    );
  });
  it("sends the low-balance notice once until the fund is refilled", async () => {
    const { prisma, events, state } = world({ limit: null, balance: 1_000n * CREDIT });
    expect(await claimPartnerCreditNotices(prisma, NOW)).toHaveLength(1);
    expect(await claimPartnerCreditNotices(prisma, NOW)).toEqual([]);
    expect(events[0]).toMatchObject({ kind: "partner.balance_low", externalTenantId: "" });
    // A refill, then a new drop under the share, is told again.
    state.refill = { id: "refill-2", amount: 10_000n * CREDIT };
    state.balance = 1_500n * CREDIT;
    expect(await claimPartnerCreditNotices(prisma, NOW)).toHaveLength(1);
    expect(events).toHaveLength(2);
  });
  it("sends nothing while the fund is above the share and nobody is at a limit", async () => {
    expect(await claimPartnerCreditNotices(world({ limit: null }).prisma, NOW)).toEqual([]);
  });
  it("sends nothing to a partner with no webhook address", async () => {
    const quiet = world({ spent: 100n * CREDIT, webhookUrl: null });
    expect(await claimPartnerCreditNotices(quiet.prisma, NOW)).toEqual([]);
    expect(quiet.events).toHaveLength(0);
  });
});

describe("auto top-up", () => {
  it("starts one top-up per threshold crossing", async () => {
    const { prisma, attempts } = world({ balance: 400n * CREDIT });
    expect(await claimAutoTopups(prisma, NOW)).toEqual([
      { attemptId: "attempt-1", partnerId: "partner-1", amountMinor: 5000, attempt: 1 },
    ]);
    expect(await claimAutoTopups(prisma, NOW)).toEqual([]);
    expect(attempts).toHaveLength(1);
  });
  it("does nothing while the fund is at or above the threshold", async () => {
    const { prisma } = world({ balance: 500n * CREDIT });
    expect(await claimAutoTopups(prisma, NOW)).toEqual([]);
  });
  it("retries a failed attempt after a backoff, and stops after the last", async () => {
    const { prisma, attempts } = world({ balance: 400n * CREDIT });
    await claimAutoTopups(prisma, NOW);
    await failAutoTopup(prisma, "attempt-1", NOW);
    expect(attempts[0]).toMatchObject({ state: "failed" });
    expect(await claimAutoTopups(prisma, new Date(NOW.getTime() + 14 * 60_000))).toEqual([]);
    const retry = await claimAutoTopups(prisma, new Date(NOW.getTime() + 16 * 60_000));
    expect(retry).toMatchObject([{ attemptId: "attempt-1", attempt: 2 }]);
    Object.assign(attempts[0] as Row, { attempts: 6, state: "failed", nextAttemptAt: NOW });
    expect(await claimAutoTopups(prisma, new Date(NOW.getTime() + 86_400_000))).toEqual([]);
  });
  it("makes a new attempt once the fund was refilled and dropped again", async () => {
    const { prisma, state, attempts } = world({ balance: 400n * CREDIT });
    await claimAutoTopups(prisma, NOW);
    state.refill = { id: "refill-2", amount: 5_000n * CREDIT };
    expect(await claimAutoTopups(prisma, NOW)).toHaveLength(1);
    expect(attempts.map((row) => row.crossingKey)).toEqual(["topup:refill-1", "topup:refill-2"]);
  });
});

describe("the partner plan", () => {
  it("grants the included credits as a lot that ends with the month, and bills the fee once", async () => {
    const { prisma, invoices, lines } = world();
    await setPartnerPlan(prisma, "partner-1", "pro", NOW);
    await setPartnerPlan(prisma, "partner-1", "pro", NOW);
    expect(vi.mocked(reconcileCreditGrantMicros)).toHaveBeenCalledWith(
      prisma,
      "wallet-org",
      {
        id: "partner-plan:partner-1:2026-11",
        amountMicros: 20_000n * CREDIT,
        expiresAt: new Date("2026-12-01T00:00:00Z"),
      },
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ period: "2026-11", currency: "BRL", totalMinor: 49_900 });
  });
  it("renews into the new month with a new lot and a new invoice line", async () => {
    const { prisma, lines, plan } = world();
    await setPartnerPlan(prisma, "partner-1", "pro", NOW);
    NOW_REF.value = new Date("2026-12-01T00:00:00Z");
    expect(await renewPartnerPlans(prisma, NOW_REF.value)).toBe(1);
    expect(vi.mocked(reconcileCreditGrantMicros).mock.calls.at(-1)?.[2]).toMatchObject({
      id: "partner-plan:partner-1:2026-12",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    expect(lines.map((line) => line.entryId)).toEqual([
      "plan:partner-1:2026-11",
      "plan:partner-1:2026-12",
    ]);
    expect(plan()?.periodEnd).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
  it("refuses a tier that is not in the live pricing", async () => {
    const { prisma } = world();
    await expect(setPartnerPlan(prisma, "partner-1", "nope", NOW)).rejects.toMatchObject({
      code: "unknown_tier",
    });
  });
});

describe("compute, storage and voice debits", () => {
  it("debits credits at the published rate under a name that makes it happen once", async () => {
    const { prisma } = world();
    const credits = await debitPartnerResource(
      prisma,
      CONFIG,
      "org-1",
      { resource: "voice", units: 10, key: "k1" },
      NOW,
    );
    // 10 minutes at 20,000 micros with no margin is 200,000 micros: 20 credits.
    expect(credits).toBe(20);
    expect(holdCredits).toHaveBeenCalledWith(
      prisma,
      "org-1",
      "resource:voice:org-1:k1",
      20n * CREDIT,
      NOW,
    );
  });
  it("debits nothing for a customer of no embedded partner, or storage under the allowance", async () => {
    const other = world({ mode: "white_label" });
    expect(
      await debitPartnerResource(
        other.prisma,
        CONFIG,
        "org-1",
        { resource: "voice", units: 10, key: "k" },
        NOW,
      ),
    ).toBe(0);
    const under = world();
    expect(
      await debitPartnerResource(
        under.prisma,
        CONFIG,
        "org-1",
        { resource: "storage", units: 4, key: "k" },
        NOW,
      ),
    ).toBe(0);
    expect(holdCredits).not.toHaveBeenCalled();
  });
});
