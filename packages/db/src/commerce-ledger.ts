import { createHash } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { commerceSettings, findCatalogPack, findCatalogPlan, fxRateAt } from "./commerce-config.js";
import {
  addMonthsUtc,
  creditMicros,
  minorOfMicros,
  periodDays,
  periodLabel,
  prorate,
  remainingPeriodDays,
  reversedTarget,
  splitRevenue,
  stateAllowsAccess,
  subscriptionState,
} from "./commerce-money.js";
import { expireModelCredits, reconcileCreditGrantMicros } from "./model-credits.js";

/** A refusal the partner can act on; the route turns the code into a status. */
export class CommerceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CommerceError";
  }
}

export interface CommercePartner {
  id: string;
  currency: string;
  commissionBps: number;
  webhookUrl?: string | null;
}

export interface CommerceTenant {
  id: string;
  organizationId: string;
  externalTenantId: string;
  state: string;
}

const short = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
const day = (at: Date) => at.toISOString().slice(0, 10);
const isUnique = (error: unknown) => (error as { code?: unknown })?.code === "P2002";

/** A notice owed to the partner; only recorded when the partner has a webhook. Returns its id. */
export async function recordCommerceEvent(
  prisma: PrismaClient,
  partner: Pick<CommercePartner, "id" | "webhookUrl">,
  event: {
    externalTenantId: string;
    kind: string;
    /** The dedupe key within (partner, customer, kind). */
    key: string;
    payload: Record<string, unknown>;
  },
): Promise<string | null> {
  if (!partner.webhookUrl) return null;
  try {
    const row = await prisma.partnerWebhookEvent.create({
      data: {
        partnerId: partner.id,
        externalTenantId: event.externalTenantId,
        kind: event.kind,
        period: event.key,
        grantedCents: 0,
        usedCents: 0,
        payload: event.payload as never,
      },
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

async function lockedRate(prisma: PrismaClient, currency: string, at: Date, now: Date) {
  if (currency === "USD") return null;
  const rate = (await fxRateAt(prisma, currency, at)) ?? (await fxRateAt(prisma, currency, now));
  if (!rate) throw new CommerceError("fx_unavailable");
  return rate;
}

interface GrantInput {
  source: string;
  kind: "plan" | "plan_upgrade" | "topup";
  period: string;
  currency: string;
  creditMinor: number;
  rateAt: Date;
  expiresAt: Date;
  spreadBps: number;
}

/** Gives the lot and records what it was for. True when this call made the grant. */
async function grantCredit(
  prisma: PrismaClient,
  tenant: CommerceTenant,
  input: GrantInput,
  now: Date,
): Promise<boolean> {
  if (input.creditMinor <= 0) return false;
  const fx = await lockedRate(prisma, input.currency, input.rateAt, now);
  const micros = creditMicros({
    currency: input.currency,
    creditMinor: input.creditMinor,
    rateE8: fx?.rateE8,
    spreadBps: input.spreadBps,
  });
  if (micros <= 0n) return false;
  await reconcileCreditGrantMicros(
    prisma,
    tenant.organizationId,
    { id: input.source, amountMicros: micros, expiresAt: input.expiresAt },
    now,
  );
  try {
    await prisma.creditGrant.create({
      data: {
        source: input.source,
        partnerTenantId: tenant.id,
        kind: input.kind,
        period: input.period,
        currency: input.currency,
        creditMinor: input.creditMinor,
        creditMicros: micros,
        fxRateId: fx?.id ?? null,
        fxRate: fx?.rate ?? null,
        expiresAt: input.expiresAt,
      },
    });
    return true;
  } catch (error) {
    if (isUnique(error)) return false;
    throw error;
  }
}

/** One immutable ledger row; a repeated source changes nothing. */
async function writeEntry(
  prisma: PrismaClient,
  data: {
    source: string;
    partnerId: string;
    partnerTenantId: string;
    kind: string;
    period: string;
    currency: string;
    baseMinor: number;
    rookShareMinor: number;
    partnerCommissionMinor: number;
    markupMinor: number;
    paidMinor: number;
    externalRef?: string | null;
    reverses?: string | null;
  },
) {
  try {
    return await prisma.revenueShareEntry.create({ data });
  } catch (error) {
    if (!isUnique(error)) throw error;
    return prisma.revenueShareEntry.findUniqueOrThrow({ where: { source: data.source } });
  }
}

export interface SubscriptionInput {
  plan: string;
  status: "active" | "past_due" | "canceled";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  chargedMinor?: number;
  externalPaymentId?: string;
  idempotencyKey: string;
}

/**
 * Sets a customer's plan and status as the partner reports it. A new period grants that period's
 * plan credit once; an upgrade inside a period adds the prorated difference as another lot; a
 * downgrade waits for the next period. Every step has a name derived from the period or the call's
 * idempotency key, so repeating the call changes nothing, even across processes.
 */
export async function setTenantSubscription(
  prisma: PrismaClient,
  partner: CommercePartner,
  tenant: CommerceTenant,
  input: SubscriptionInput,
  now = new Date(),
) {
  const settings = await commerceSettings(prisma);
  const catalog = await findCatalogPlan(prisma, input.plan, partner.currency);
  if (!catalog) throw new CommerceError("unknown_plan");
  if (input.currentPeriodEnd <= input.currentPeriodStart) throw new CommerceError("invalid_period");
  const existing = await prisma.tenantSubscription.findUnique({
    where: { partnerTenantId: tenant.id },
  });
  if (existing && input.currentPeriodStart < existing.periodStart) {
    throw new CommerceError("stale_period");
  }
  const newPeriod = !existing || input.currentPeriodStart > existing.periodStart;
  const start = input.currentPeriodStart;
  const period = periodLabel(start);
  const prefix = `${partner.id}:${tenant.id}:${day(start)}`;
  const key = short(input.idempotencyKey);

  let planKey = input.plan;
  let baseMinor = catalog.baseMinor;
  let pendingPlanKey: string | null = null;
  let upgradeFrom: { baseMinor: number; creditMinor: number } | null = null;
  if (existing && !newPeriod && existing.planKey !== input.plan) {
    if (catalog.baseMinor > existing.baseMinor) {
      const old = await findCatalogPlan(prisma, existing.planKey, partner.currency);
      upgradeFrom = { baseMinor: existing.baseMinor, creditMinor: old?.creditMinor ?? 0 };
    } else {
      planKey = existing.planKey;
      baseMinor = existing.baseMinor;
      pendingPlanKey = input.plan;
    }
  } else if (existing && !newPeriod) {
    planKey = existing.planKey;
    baseMinor = existing.baseMinor;
  }
  // A plan that never had its period's credit (it was past due) is a fresh sale, not an upgrade.
  if (
    upgradeFrom &&
    !(await prisma.creditGrant.findUnique({ where: { source: `commerce:${prefix}:sub` } }))
  ) {
    upgradeFrom = null;
  }
  const markupMinor =
    input.chargedMinor == null
      ? existing && !newPeriod
        ? existing.markupMinor
        : 0
      : Math.max(0, input.chargedMinor - baseMinor);

  const row = {
    planKey,
    pendingPlanKey,
    status: input.status,
    currency: partner.currency,
    periodStart: start,
    periodEnd: input.currentPeriodEnd,
    baseMinor,
    markupMinor,
    chargedMinor: input.chargedMinor ?? null,
    externalRef: input.externalPaymentId ?? existing?.externalRef ?? null,
    pastDueSince: input.status === "past_due" ? (existing?.pastDueSince ?? now) : null,
    lapsedAt: input.status === "active" ? null : (existing?.lapsedAt ?? null),
  };
  await prisma.tenantSubscription.upsert({
    where: { partnerTenantId: tenant.id },
    create: { partnerTenantId: tenant.id, ...row },
    update: row,
  });

  const events: string[] = [];
  const notify = async (kind: string, key: string, payload: Record<string, unknown>) => {
    const id = await recordCommerceEvent(prisma, partner, {
      externalTenantId: tenant.externalTenantId,
      kind,
      key,
      payload,
    });
    if (id) events.push(id);
  };

  if (input.status === "active") {
    const lot = (source: string, kind: GrantInput["kind"], creditMinor: number) =>
      grantCredit(
        prisma,
        tenant,
        {
          source,
          kind,
          period,
          currency: partner.currency,
          creditMinor,
          rateAt: start,
          expiresAt: input.currentPeriodEnd,
          spreadBps: settings.fxSpreadBps,
        },
        now,
      );
    const grants: Array<{ kind: string; creditMinor: number; id: string }> = [];
    const planGrantSource = `commerce:${prefix}:sub`;
    // The period's grant and its ledger row, once: a past-due report that later turns active
    // gets them then, and a repeated report finds both done.
    await writeEntry(prisma, {
      source: `rs:${prefix}:sub`,
      partnerId: partner.id,
      partnerTenantId: tenant.id,
      kind: "subscription",
      period,
      currency: partner.currency,
      ...splitRevenue(baseMinor, partner.commissionBps, input.chargedMinor ?? null),
      paidMinor: input.chargedMinor ?? baseMinor,
      externalRef: input.externalPaymentId ?? null,
    });
    const planCreditMinor =
      (await findCatalogPlan(prisma, planKey, partner.currency))?.creditMinor ?? 0;
    if (await lot(planGrantSource, "plan", planCreditMinor)) {
      grants.push({ kind: "plan", creditMinor: planCreditMinor, id: planGrantSource });
    }
    if (upgradeFrom) {
      const remaining = remainingPeriodDays(now, input.currentPeriodEnd);
      const total = periodDays(start, input.currentPeriodEnd);
      const creditDiff = prorate(
        Math.max(0, catalog.creditMinor - upgradeFrom.creditMinor),
        remaining,
        total,
      );
      const baseDiff = prorate(catalog.baseMinor - upgradeFrom.baseMinor, remaining, total);
      await writeEntry(prisma, {
        source: `rs:${prefix}:upg:${key}`,
        partnerId: partner.id,
        partnerTenantId: tenant.id,
        kind: "subscription",
        period: periodLabel(now),
        currency: partner.currency,
        ...splitRevenue(baseDiff, partner.commissionBps, null),
        paidMinor: baseDiff,
        externalRef: input.externalPaymentId ?? null,
      });
      if (await lot(`commerce:${prefix}:upg:${key}`, "plan_upgrade", creditDiff)) {
        grants.push({
          kind: "plan_upgrade",
          creditMinor: creditDiff,
          id: `commerce:${prefix}:upg:${key}`,
        });
      }
    }
    for (const grant of grants) {
      await notify("credit.granted", `${period}:${grant.id}`, {
        period,
        currency: partner.currency,
        kind: grant.kind,
        creditMinor: grant.creditMinor,
      });
    }
  }

  const changed =
    !existing ||
    existing.planKey !== planKey ||
    existing.status !== input.status ||
    existing.periodStart.getTime() !== start.getTime() ||
    existing.pendingPlanKey !== pendingPlanKey;
  if (changed) {
    await notify("subscription.updated", `${period}:${input.status}:${planKey}:${key}`, {
      period,
      currency: partner.currency,
      plan: planKey,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd.toISOString(),
    });
  }

  const balance = await commerceBalance(prisma, partner, tenant, now);
  const shares = await prisma.revenueShareEntry.aggregate({
    _sum: { rookShareMinor: true },
    where: {
      partnerTenantId: tenant.id,
      kind: "subscription",
      source: { startsWith: `rs:${prefix}:` },
    },
  });
  return {
    events,
    body: {
      tenantId: tenant.id,
      plan: planKey,
      status: input.status,
      period,
      credit: {
        currency: partner.currency,
        grantedMinor: balance.plan.grantedMinor,
        usedMinor: balance.plan.usedMinor,
        remainingMinor: balance.plan.remainingMinor,
      },
      rookShareMinor: shares._sum.rookShareMinor ?? 0,
    },
  };
}

export interface TopupInput {
  pack: string;
  quantity: number;
  paidMinor: number;
  externalPaymentId: string;
  idempotencyKey: string;
}

/** Adds a purchased pack as one lot that lasts a year, and writes its revenue share. */
export async function addTenantTopup(
  prisma: PrismaClient,
  partner: CommercePartner,
  tenant: CommerceTenant,
  input: TopupInput,
  now = new Date(),
) {
  if (tenant.state === "suspended") throw new CommerceError("tenant_suspended");
  const settings = await commerceSettings(prisma);
  const subscription = await prisma.tenantSubscription.findUnique({
    where: { partnerTenantId: tenant.id },
  });
  if (!stateAllowsAccess(subscriptionState(subscription, now, settings.graceDays))) {
    throw new CommerceError("plan_inactive");
  }
  const pack = await findCatalogPack(prisma, input.pack, partner.currency);
  if (!pack) throw new CommerceError("unknown_pack");
  const baseMinor = pack.baseMinor * input.quantity;
  const creditMinor = pack.creditMinor * input.quantity;
  if (Math.max(baseMinor, input.paidMinor) > settings.maxTopupMinorPerCall) {
    throw new CommerceError("limit_exceeded");
  }
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = await prisma.revenueShareEntry.aggregate({
    _sum: { paidMinor: true },
    where: { partnerTenantId: tenant.id, kind: "topup", createdAt: { gte: dayStart } },
  });
  const key = short(input.idempotencyKey);
  const source = `${partner.id}:${tenant.id}:topup:${key}`;
  const done = await prisma.revenueShareEntry.findUnique({ where: { source: `rs:${source}` } });
  if (!done && (today._sum.paidMinor ?? 0) + input.paidMinor > settings.maxTopupMinorPerDay) {
    throw new CommerceError("limit_exceeded");
  }
  const split = splitRevenue(baseMinor, partner.commissionBps, input.paidMinor);
  const expiresAt = addMonthsUtc(now, settings.topupExpiryMonths);
  const granted = await grantCredit(
    prisma,
    tenant,
    {
      source: `commerce:${source}`,
      kind: "topup",
      period: periodLabel(now),
      currency: partner.currency,
      creditMinor,
      rateAt: now,
      expiresAt,
      spreadBps: settings.fxSpreadBps,
    },
    now,
  );
  await writeEntry(prisma, {
    source: `rs:${source}`,
    partnerId: partner.id,
    partnerTenantId: tenant.id,
    kind: "topup",
    period: periodLabel(now),
    currency: partner.currency,
    ...split,
    paidMinor: input.paidMinor,
    externalRef: input.externalPaymentId,
  });
  const grant = await prisma.creditGrant.findUniqueOrThrow({
    where: { source: `commerce:${source}` },
  });
  const events: string[] = [];
  if (granted) {
    const id = await recordCommerceEvent(prisma, partner, {
      externalTenantId: tenant.externalTenantId,
      kind: "credit.granted",
      key: `${periodLabel(now)}:${grant.source}`,
      payload: { period: periodLabel(now), currency: partner.currency, kind: "topup", creditMinor },
    });
    if (id) events.push(id);
  }
  const balance = await commerceBalance(prisma, partner, tenant, now);
  return {
    events,
    body: {
      topupId: grant.id,
      creditMinor,
      balance: { currency: partner.currency, remainingMinor: balance.remainingMinor },
      rookShareMinor: split.rookShareMinor,
    },
  };
}

export interface RefundInput {
  externalPaymentId: string;
  amountMinor?: number;
  idempotencyKey: string;
}

const targetMicros = (total: bigint, cumulative: number, paid: number): bigint =>
  paid <= 0 ? 0n : cumulative >= paid ? total : (total * BigInt(cumulative)) / BigInt(paid);

/**
 * Reverses a payment's revenue share, in whole or in part, with a negative ledger row, and takes
 * back only the credit that is still unused. Credit already spent stays spent: Rook's AI cost is
 * real. Reversals add up to the original exactly, whatever the order of partial refunds.
 */
export async function refundTenantPayment(
  prisma: PrismaClient,
  partner: CommercePartner,
  tenant: CommerceTenant,
  input: RefundInput,
  now = new Date(),
) {
  const original = await prisma.revenueShareEntry.findFirst({
    where: {
      partnerId: partner.id,
      partnerTenantId: tenant.id,
      externalRef: input.externalPaymentId,
      kind: { in: ["subscription", "topup"] },
      reverses: null,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!original) throw new CommerceError("unknown_payment");
  const paid = original.paidMinor > 0 ? original.paidMinor : original.baseMinor;
  const source = `rs:${partner.id}:refund:${short(input.idempotencyKey)}`;
  const previous = await prisma.revenueShareEntry.findMany({
    where: { reverses: original.id },
    select: { paidMinor: true, source: true },
  });
  const done = previous.find((row) => row.source === source);
  const refundedBefore = previous
    .filter((row) => row.source !== source)
    .reduce((sum, row) => sum - row.paidMinor, 0);
  const amount = input.amountMinor ?? paid - refundedBefore;
  const cumulative = refundedBefore + amount;
  if (!done && (amount <= 0 || cumulative > paid)) throw new CommerceError("refund_exceeds");

  const part = (total: number) =>
    reversedTarget(total, cumulative, paid) - reversedTarget(total, refundedBefore, paid);
  const entry = done
    ? await prisma.revenueShareEntry.findUniqueOrThrow({ where: { source } })
    : await writeEntry(prisma, {
        source,
        partnerId: partner.id,
        partnerTenantId: tenant.id,
        kind: "refund",
        period: periodLabel(now),
        currency: original.currency,
        baseMinor: -part(original.baseMinor),
        rookShareMinor: -part(original.rookShareMinor),
        partnerCommissionMinor: -part(original.partnerCommissionMinor),
        markupMinor: -part(original.markupMinor),
        paidMinor: -amount,
        externalRef: original.externalRef,
        reverses: original.id,
      });

  // The credit that came with the payment, shrunk by the unused part of the refunded share.
  let creditRemovedMinor = 0;
  const grant = await prisma.creditGrant.findUnique({
    where: { source: original.source.replace(/^rs:/, "commerce:") },
  });
  if (grant && !done) {
    await expireModelCredits(prisma, tenant.organizationId, now);
    const entryRow = await prisma.modelCreditEntry.findUnique({
      where: { source: `purchase:${grant.source}` },
    });
    const lot = entryRow
      ? await prisma.modelCreditLot.findUnique({ where: { id: entryRow.id } })
      : null;
    if (lot) {
      const wanted =
        targetMicros(grant.creditMicros, cumulative, paid) -
        targetMicros(grant.creditMicros, refundedBefore, paid);
      const removed = wanted < lot.availableMicros ? wanted : lot.availableMicros;
      if (removed > 0n) {
        await reconcileCreditGrantMicros(
          prisma,
          tenant.organizationId,
          { id: grant.source, amountMicros: lot.amountMicros - removed },
          now,
        );
        creditRemovedMinor = minorOfMicros(grant.creditMinor, lot.amountMicros, removed);
        await prisma.creditGrant.update({
          where: { id: grant.id },
          data: { creditMinor: grant.creditMinor - creditRemovedMinor },
        });
      }
    }
  }
  return {
    events: [] as string[],
    body: {
      refundId: entry.id,
      currency: original.currency,
      refundedMinor: -entry.paidMinor,
      reversed: {
        baseMinor: -entry.baseMinor,
        rookShareMinor: -entry.rookShareMinor,
        partnerCommissionMinor: -entry.partnerCommissionMinor,
        markupMinor: -entry.markupMinor,
      },
      creditRemovedMinor,
    },
  };
}

export interface CommerceBalance {
  currency: string;
  period: string | null;
  planKey: string | null;
  planName: string | null;
  state: "none" | "active" | "past_due" | "canceled" | "lapsed";
  periodEnd: Date | null;
  plan: { grantedMinor: number; usedMinor: number; remainingMinor: number; expiresAt: Date | null };
  topup: { remainingMinor: number };
  remainingMinor: number;
  fxRate: string | null;
  lowThresholdReached: boolean;
}

/** What a customer has, in the partner's currency, rounded down so it never shows more than exists. */
export async function commerceBalance(
  prisma: PrismaClient,
  partner: Pick<CommercePartner, "currency">,
  tenant: Pick<CommerceTenant, "id" | "organizationId">,
  now = new Date(),
): Promise<CommerceBalance> {
  await expireModelCredits(prisma, tenant.organizationId, now);
  const settings = await commerceSettings(prisma);
  const subscription = await prisma.tenantSubscription.findUnique({
    where: { partnerTenantId: tenant.id },
  });
  const period = subscription ? periodLabel(subscription.periodStart) : null;
  const grants = await prisma.creditGrant.findMany({
    where: {
      partnerTenantId: tenant.id,
      OR: [
        { kind: { in: ["plan", "plan_upgrade"] }, ...(period ? { period } : { id: "none" }) },
        { kind: "topup", expiresAt: { gt: now } },
      ],
    },
  });
  const entries = await prisma.modelCreditEntry.findMany({
    where: {
      organizationId: tenant.organizationId,
      source: { in: grants.map((grant) => `purchase:${grant.source}`) },
    },
    select: { id: true, source: true },
  });
  const lots = await prisma.modelCreditLot.findMany({
    where: { id: { in: entries.map((entry) => entry.id) } },
  });
  const lotOf = new Map(
    entries.map((entry) => [entry.source, lots.find((lot) => lot.id === entry.id)]),
  );
  let planGranted = 0;
  let planUsed = 0;
  let planRemaining = 0;
  let topupRemaining = 0;
  let planMicros = 0n;
  let planUsedMicros = 0n;
  let fxRate: string | null = null;
  for (const grant of grants) {
    const lot = lotOf.get(`purchase:${grant.source}`);
    if (!lot) continue;
    const remaining = minorOfMicros(grant.creditMinor, lot.amountMicros, lot.availableMicros);
    if (grant.kind === "topup") {
      topupRemaining += remaining;
      continue;
    }
    planGranted += grant.creditMinor;
    planUsed += minorOfMicros(grant.creditMinor, lot.amountMicros, lot.usedMicros);
    planRemaining += remaining;
    planMicros += lot.amountMicros;
    planUsedMicros += lot.usedMicros;
    fxRate = grant.fxRate ?? fxRate;
  }
  const state = subscriptionState(subscription, now, settings.graceDays);
  return {
    currency: partner.currency,
    period,
    planKey: subscription?.planKey ?? null,
    planName: subscription
      ? ((await prisma.catalogPlan.findUnique({ where: { key: subscription.planKey } }))?.name ??
        subscription.planKey)
      : null,
    state,
    periodEnd: subscription?.periodEnd ?? null,
    plan: {
      grantedMinor: planGranted,
      usedMinor: planUsed,
      remainingMinor: planRemaining,
      expiresAt: subscription?.periodEnd ?? null,
    },
    topup: { remainingMinor: topupRemaining },
    remainingMinor: planRemaining + topupRemaining,
    fxRate,
    lowThresholdReached:
      planMicros > 0n && planUsedMicros * 10_000n >= planMicros * BigInt(settings.lowCreditBps),
  };
}

/** Usage by day for a month, in the partner's currency. Totals and dates only. */
export async function commerceUsage(
  prisma: PrismaClient,
  partner: Pick<CommercePartner, "currency">,
  tenant: Pick<CommerceTenant, "id" | "organizationId">,
  period: string,
) {
  const [year, month] = period.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.$queryRaw<Array<{ d: Date; micros: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS d, SUM(-"amountMicros")::bigint AS micros
    FROM model_credit_entries
    WHERE "organizationId" = ${tenant.organizationId} AND "callId" IS NOT NULL
      AND "amountMicros" < 0 AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY 1 ORDER BY 1`;
  const reference = await prisma.creditGrant.findFirst({
    where: { partnerTenantId: tenant.id, period, kind: "plan" },
  });
  const toMinor = (micros: bigint) =>
    reference && partner.currency !== "USD"
      ? minorOfMicros(reference.creditMinor, reference.creditMicros, micros)
      : Number(micros / 10_000n);
  const byDay = rows.map((row) => ({
    date: row.d.toISOString().slice(0, 10),
    usedMinor: toMinor(row.micros),
  }));
  return {
    period,
    currency: partner.currency,
    usedMinor: byDay.reduce((sum, row) => sum + row.usedMinor, 0),
    byDay,
  };
}
