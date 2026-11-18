import type { PartnerPricingConfig } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { recordCommerceEvent } from "./commerce-ledger.js";
import { holdCredits, reconcileCreditGrantMicros } from "./model-credits.js";
import type { DebitedResource } from "./partner-credit-rules.js";
import {
  creditLimitReached,
  creditPeriod,
  creditPeriodEnd,
  creditPeriodStart,
  fundBelowThreshold,
  fundIsLow,
  MAX_TOPUP_ATTEMPTS,
  modelAllowed,
  resourceCredits,
  resourceHoldId,
  splitFund,
  topupBackoffMinutes,
} from "./partner-credit-rules.js";
import { CREDIT_MICROS, livePartnerPricing } from "./partner-pricing.js";
import { partnerWalletOrganization } from "./partner-wallet.js";

/**
 * Run-time rules of the embedded credit model: the per-customer limit, the allowed models, the two
 * webhooks, auto top-up, the partner plan and the metering of compute, storage and voice. Every
 * function takes a client that runs as the system. Customer-owned models never reach any of this:
 * only deployment credentials go through the credit meter.
 */

export type PartnerSpendRefusal = "credit_limit_reached" | "model_not_allowed";

export class PartnerSpendRefused extends Error {
  constructor(readonly reason: PartnerSpendRefusal) {
    super(reason);
    this.name = "PartnerSpendRefused";
  }
}

async function tenantOf(prisma: PrismaClient, organizationId: string) {
  return prisma.partnerTenant.findUnique({
    where: { organizationId },
    select: {
      creditLimitCredits: true,
      partner: { select: { creditAllowedModels: true, mode: true } },
    },
  });
}

/** Credits a customer has spent from the start of the period, as micro-dollars. */
export async function customerSpentMicros(
  prisma: PrismaClient,
  organizationId: string,
  now: Date,
): Promise<bigint> {
  const spent = await prisma.modelCreditEntry.aggregate({
    _sum: { amountMicros: true },
    where: {
      organizationId,
      amountMicros: { lt: 0n },
      createdAt: { gte: creditPeriodStart(now) },
    },
  });
  return -(spent._sum.amountMicros ?? 0n);
}

/**
 * Refuses a Rook-provided model call by a partner's customer that is outside the partner's allowed
 * models or past its monthly credit limit. Nothing happens for an organization that belongs to no
 * embedded partner.
 */
export async function assertPartnerSpendAllowed(
  prisma: PrismaClient,
  organizationId: string,
  call: { provider?: string; model?: string },
  now = new Date(),
): Promise<void> {
  const tenant = await tenantOf(prisma, organizationId);
  if (!tenant || tenant.partner.mode !== "embedded") return;
  if (
    call.model &&
    !modelAllowed(tenant.partner.creditAllowedModels, call.provider ?? "", call.model)
  ) {
    throw new PartnerSpendRefused("model_not_allowed");
  }
  if (tenant.creditLimitCredits === null) return;
  const spent = await customerSpentMicros(prisma, organizationId, now);
  if (creditLimitReached(spent, tenant.creditLimitCredits)) {
    throw new PartnerSpendRefused("credit_limit_reached");
  }
}

/**
 * The partner's allowed Rook-provided models for the customer a space belongs to; empty means all,
 * and null means the space is not a partner customer's.
 */
export async function partnerAllowedModels(
  prisma: PrismaClient,
  spaceId: string,
): Promise<string[] | null> {
  const tenant = await prisma.partnerTenant.findFirst({
    where: { organization: { spaces: { some: { id: spaceId } } } },
    select: { partner: { select: { creditAllowedModels: true, mode: true } } },
  });
  if (!tenant || tenant.partner.mode !== "embedded") return null;
  return tenant.partner.creditAllowedModels;
}

async function lastRefill(prisma: PrismaClient, walletOrganizationId: string, now: Date) {
  const latest = await prisma.modelCreditEntry.findFirst({
    where: {
      organizationId: walletOrganizationId,
      amountMicros: { gt: 0n },
      source: { startsWith: "purchase:" },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, amountMicros: true },
  });
  const thisPeriod = await prisma.modelCreditEntry.aggregate({
    _sum: { amountMicros: true },
    where: {
      organizationId: walletOrganizationId,
      amountMicros: { gt: 0n },
      source: { startsWith: "purchase:" },
      createdAt: { gte: creditPeriodStart(now) },
    },
  });
  const added = thisPeriod._sum.amountMicros ?? 0n;
  const last = latest?.amountMicros ?? 0n;
  return {
    /** Changes with every refill, so a notice or a top-up is made once per drop. */
    marker: latest?.id ?? "none",
    /** What the fund was filled with this period, or the last refill when none is this period. */
    referenceMicros: added > last ? added : last,
  };
}

async function fundBalance(prisma: PrismaClient, walletOrganizationId: string) {
  const account = await prisma.modelCreditAccount.findUnique({
    where: { organizationId: walletOrganizationId },
    select: { balanceMicros: true },
  });
  return account?.balanceMicros ?? 0n;
}

/**
 * Records the two notices the credit model owes a partner with a webhook, once each:
 * `customer.credit_limit_reached` per customer and period, and `partner.balance_low` once until
 * the fund is refilled. Returns the notices made now, for the caller to queue.
 */
export async function claimPartnerCreditNotices(
  prisma: PrismaClient,
  now = new Date(),
): Promise<string[]> {
  const partners = await prisma.partner.findMany({
    where: { enabled: true, mode: "embedded", webhookUrl: { not: null } },
    select: { id: true, webhookUrl: true, currency: true },
    take: 100,
  });
  if (partners.length === 0) return [];
  const period = creditPeriod(now);
  const config = (await livePartnerPricing(prisma))?.config;
  const made: string[] = [];
  for (const partner of partners) {
    const tenants = await prisma.partnerTenant.findMany({
      where: { partnerId: partner.id, creditLimitCredits: { not: null } },
      select: { externalTenantId: true, organizationId: true, creditLimitCredits: true },
      take: 1000,
    });
    for (const tenant of tenants) {
      const spent = await customerSpentMicros(prisma, tenant.organizationId, now);
      if (!creditLimitReached(spent, tenant.creditLimitCredits)) continue;
      const id = await recordCommerceEvent(prisma, partner, {
        externalTenantId: tenant.externalTenantId,
        kind: "customer.credit_limit_reached",
        key: period,
        payload: {
          period,
          limitCredits: tenant.creditLimitCredits,
          usedCredits: Number(spent / CREDIT_MICROS),
        },
      });
      if (id) made.push(id);
    }
    if (!config) continue;
    const wallet = await partnerWalletOrganization(prisma, partner.id);
    if (!wallet) continue;
    const [balance, refill] = await Promise.all([
      fundBalance(prisma, wallet),
      lastRefill(prisma, wallet, now),
    ]);
    if (!fundIsLow(balance, refill.referenceMicros, config.lowBalanceBps)) continue;
    const id = await recordCommerceEvent(prisma, partner, {
      // The notice is about the partner's fund, not one customer.
      externalTenantId: "",
      kind: "partner.balance_low",
      key: `low:${refill.marker}`,
      payload: {
        balanceCredits: Number(balance / CREDIT_MICROS),
        thresholdBps: config.lowBalanceBps,
        currency: partner.currency,
      },
    });
    if (id) made.push(id);
  }
  return made;
}

export interface AutoTopupDue {
  attemptId: string;
  partnerId: string;
  amountMinor: number;
  attempt: number;
}

/**
 * The auto top-ups to run now. One attempt is made for each time a fund falls under its threshold
 * (the crossing is named by the last refill, so a top-up that started is never started twice);
 * a failed attempt comes back after a growing delay, up to a handful of times.
 */
export async function claimAutoTopups(
  prisma: PrismaClient,
  now = new Date(),
): Promise<AutoTopupDue[]> {
  const partners = await prisma.partner.findMany({
    where: {
      enabled: true,
      mode: "embedded",
      autoTopupEnabled: true,
      autoTopupThresholdCredits: { not: null },
      autoTopupAmountMinor: { not: null },
    },
    select: {
      id: true,
      autoTopupThresholdCredits: true,
      autoTopupAmountMinor: true,
    },
    take: 100,
  });
  const due: AutoTopupDue[] = [];
  for (const partner of partners) {
    const wallet = await partnerWalletOrganization(prisma, partner.id);
    if (!wallet) continue;
    const balance = await fundBalance(prisma, wallet);
    if (!fundBelowThreshold(balance, partner.autoTopupThresholdCredits!)) continue;
    const { marker } = await lastRefill(prisma, wallet, now);
    const crossingKey = `topup:${marker}`;
    const amountMinor = partner.autoTopupAmountMinor!;
    const existing = await prisma.partnerAutoTopupAttempt.findUnique({
      where: { partnerId_crossingKey: { partnerId: partner.id, crossingKey } },
    });
    if (!existing) {
      try {
        const row = await prisma.partnerAutoTopupAttempt.create({
          data: {
            partnerId: partner.id,
            crossingKey,
            amountMinor,
            state: "started",
            attempts: 1,
            nextAttemptAt: now,
          },
        });
        due.push({ attemptId: row.id, partnerId: partner.id, amountMinor, attempt: 1 });
      } catch (error) {
        // Another process took this crossing.
        if ((error as { code?: unknown })?.code !== "P2002") throw error;
      }
      continue;
    }
    if (
      existing.state !== "failed" ||
      existing.nextAttemptAt > now ||
      existing.attempts >= MAX_TOPUP_ATTEMPTS
    ) {
      continue;
    }
    const previous = existing.attempts;
    const taken = await prisma.partnerAutoTopupAttempt.updateMany({
      where: { id: existing.id, state: "failed", attempts: previous },
      data: { state: "started", attempts: previous + 1 },
    });
    if (taken.count === 1) {
      due.push({
        attemptId: existing.id,
        partnerId: partner.id,
        amountMinor: existing.amountMinor,
        attempt: previous + 1,
      });
    }
  }
  return due;
}

/** A failed attempt waits before the next; a started one stays started so it is not repeated. */
export async function failAutoTopup(
  prisma: PrismaClient,
  attemptId: string,
  now = new Date(),
): Promise<void> {
  const row = await prisma.partnerAutoTopupAttempt.findUnique({ where: { id: attemptId } });
  if (!row) return;
  await prisma.partnerAutoTopupAttempt.update({
    where: { id: attemptId },
    data: {
      state: "failed",
      nextAttemptAt: new Date(now.getTime() + topupBackoffMinutes(row.attempts) * 60_000),
    },
  });
}

/**
 * Debits one resource from a customer's credit at the published rates, once per `key`. A customer
 * of no embedded partner, or one with no credit to take from, is left alone. Returns the credits
 * debited.
 */
export async function debitPartnerResource(
  prisma: PrismaClient,
  config: PartnerPricingConfig,
  organizationId: string,
  input: { resource: DebitedResource; units: number; key: string },
  now = new Date(),
): Promise<number> {
  const tenant = await tenantOf(prisma, organizationId);
  if (!tenant || tenant.partner.mode !== "embedded") return 0;
  const credits = resourceCredits(config, input.resource, input.units);
  if (credits <= 0) return 0;
  const outcome = await holdCredits(
    prisma,
    organizationId,
    resourceHoldId(input.resource, organizationId, input.key),
    BigInt(credits) * CREDIT_MICROS,
    now,
  );
  return outcome === "held" ? credits : 0;
}

const METER_LOOKBACK_MS = 3 * 86_400_000;

/**
 * Debits the computer minutes of runs that ended recently (once per run) and, in the first sweep
 * after a month ends, the storage a customer kept above the allowance. Safe to repeat.
 */
export async function meterPartnerResources(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  const config = (await livePartnerPricing(prisma))?.config;
  if (!config) return 0;
  const tenants = await prisma.partnerTenant.findMany({
    where: { partner: { enabled: true, mode: "embedded" } },
    select: { organizationId: true },
    take: 2000,
  });
  if (tenants.length === 0) return 0;
  const organizationIds = tenants.map((tenant) => tenant.organizationId);
  let debited = 0;
  const runs = await prisma.computerRun.findMany({
    where: {
      endedAt: { gte: new Date(now.getTime() - METER_LOOKBACK_MS), lte: now },
      space: { organizationId: { in: organizationIds } },
    },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      space: { select: { organizationId: true } },
    },
    take: 2000,
  });
  for (const run of runs) {
    if (!run.endedAt || !run.space) continue;
    const minutes = Math.ceil((run.endedAt.getTime() - run.startedAt.getTime()) / 60_000);
    debited += await debitPartnerResource(
      prisma,
      config,
      run.space.organizationId,
      { resource: "computer", units: minutes, key: run.id },
      now,
    );
  }
  const closed = creditPeriod(new Date(creditPeriodStart(now).getTime() - 1));
  const storage = await prisma.storageUsage.findMany({
    where: { organizationId: { in: organizationIds }, bytes: { gt: 0n } },
    select: { organizationId: true, bytes: true },
  });
  for (const row of storage) {
    debited += await debitPartnerResource(
      prisma,
      config,
      row.organizationId,
      { resource: "storage", units: Number(row.bytes) / 1024 ** 3, key: closed },
      now,
    );
  }
  return debited;
}

/** What the partner's fund holds: plan credits that end with the period, and top-up credits. */
export async function partnerFund(prisma: PrismaClient, partnerId: string, now = new Date()) {
  const wallet = await partnerWalletOrganization(prisma, partnerId);
  const plan = await prisma.partnerPlan.findUnique({ where: { partnerId } });
  if (!wallet) return { planCredits: 0, topupCredits: 0, plan };
  const lots = await prisma.modelCreditLot.findMany({
    where: { organizationId: wallet, availableMicros: { gt: 0n } },
    select: { id: true, availableMicros: true, expiresAt: true },
  });
  const entries = await prisma.modelCreditEntry.findMany({
    where: { id: { in: lots.map((lot) => lot.id) } },
    select: { id: true, source: true },
  });
  const source = new Map(entries.map((entry) => [entry.id, entry.source]));
  const split = splitFund(
    lots.map((lot) => ({ ...lot, source: source.get(lot.id) ?? "" })),
    now,
  );
  return {
    planCredits: Number(split.planMicros / CREDIT_MICROS),
    topupCredits: Number(split.topupMicros / CREDIT_MICROS),
    plan,
  };
}

export class PartnerPlanError extends Error {
  constructor(readonly code: "no_pricing" | "unknown_tier" | "no_price" | "no_wallet") {
    super(code);
    this.name = "PartnerPlanError";
  }
}

async function grantPlanPeriod(
  prisma: PrismaClient,
  plan: { partnerId: string; currency: string; priceMinor: number; includedCredits: number },
  now: Date,
) {
  const wallet = await partnerWalletOrganization(prisma, plan.partnerId);
  if (!wallet) throw new PartnerPlanError("no_wallet");
  const period = creditPeriod(now);
  await reconcileCreditGrantMicros(
    prisma,
    wallet,
    {
      id: `partner-plan:${plan.partnerId}:${period}`,
      amountMicros: BigInt(plan.includedCredits) * CREDIT_MICROS,
      expiresAt: creditPeriodEnd(now),
    },
    now,
  );
  // The plan fee goes on the period's invoice, once; an invoice already issued is not changed.
  const invoice = await prisma.partnerInvoice.upsert({
    where: {
      partnerId_period_currency: { partnerId: plan.partnerId, period, currency: plan.currency },
    },
    create: { partnerId: plan.partnerId, period, currency: plan.currency, totalMinor: 0 },
    update: {},
  });
  if (invoice.state !== "draft") return;
  await prisma.partnerInvoiceLine.createMany({
    data: [
      {
        invoiceId: invoice.id,
        // The fee belongs to the partner itself, not to a customer.
        partnerTenantId: plan.partnerId,
        kind: "partner_plan",
        entryId: `plan:${plan.partnerId}:${period}`,
        rookShareMinor: plan.priceMinor,
      },
    ],
    skipDuplicates: true,
  });
  const total = await prisma.partnerInvoiceLine.aggregate({
    _sum: { rookShareMinor: true },
    where: { invoiceId: invoice.id },
  });
  await prisma.partnerInvoice.update({
    where: { id: invoice.id },
    data: { totalMinor: total._sum.rookShareMinor ?? 0 },
  });
}

/**
 * Puts a partner on a tier of the live pricing version (or takes it off with a null tier). The
 * included credits of the month are granted to its fund as a lot that ends with the month, and the
 * fee goes on the month's invoice.
 */
export async function setPartnerPlan(
  prisma: PrismaClient,
  partnerId: string,
  tierKey: string | null,
  now = new Date(),
): Promise<void> {
  if (tierKey === null) {
    await prisma.partnerPlan.updateMany({ where: { partnerId }, data: { status: "canceled" } });
    return;
  }
  const pricing = await livePartnerPricing(prisma);
  if (!pricing) throw new PartnerPlanError("no_pricing");
  const tier = pricing.config.tiers.find((candidate) => candidate.key === tierKey);
  if (!tier) throw new PartnerPlanError("unknown_tier");
  const partner = await prisma.partner.findUniqueOrThrow({
    where: { id: partnerId },
    select: { currency: true },
  });
  const price = tier.prices[partner.currency as "BRL" | "USD"];
  if (!price) throw new PartnerPlanError("no_price");
  const data = {
    tierKey,
    pricingVersion: pricing.version,
    currency: partner.currency,
    priceMinor: price.priceMinor,
    includedCredits: price.includedCredits,
    status: "active",
    periodStart: creditPeriodStart(now),
    periodEnd: creditPeriodEnd(now),
  };
  await prisma.partnerPlan.upsert({
    where: { partnerId },
    create: { partnerId, ...data },
    update: data,
  });
  await grantPlanPeriod(prisma, { partnerId, ...data }, now);
}

/**
 * Rolls every active plan whose period has ended into the current month: new plan credits, the
 * fee on the invoice. The old period's credits ended with it. Safe to repeat. Returns how many
 * plans were renewed.
 */
export async function renewPartnerPlans(prisma: PrismaClient, now = new Date()): Promise<number> {
  const due = await prisma.partnerPlan.findMany({
    where: { status: "active", periodEnd: { lte: now }, partner: { enabled: true } },
    take: 200,
  });
  let renewed = 0;
  for (const plan of due) {
    try {
      await grantPlanPeriod(prisma, plan, now);
    } catch (error) {
      if (error instanceof PartnerPlanError) continue;
      throw error;
    }
    await prisma.partnerPlan.update({
      where: { partnerId: plan.partnerId },
      data: { periodStart: creditPeriodStart(now), periodEnd: creditPeriodEnd(now) },
    });
    renewed += 1;
  }
  return renewed;
}
