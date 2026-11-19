import { randomUUID } from "node:crypto";
import type { AgentUsage, BillingCreditPurchase } from "@corvo/adapter-kit";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./generated/prisma/client.js";
import type { CreditAllocation } from "./model-credit-lots.js";
import {
  allocateCreditLots,
  allocatedMicros,
  expireCreditLots,
  prepareCreditLots,
  resizeCreditLot,
  returnCreditLots,
  syncLotBalance,
} from "./model-credit-lots.js";

export const MICROS_PER_DOLLAR = 1_000_000;

export async function creditAccount(prisma: PrismaClient, organizationId: string) {
  try {
    return await prisma.modelCreditAccount.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"))
      throw error;
    // Empty-update upserts can race; the organization primary key is the only unique constraint.
    return prisma.modelCreditAccount.findUniqueOrThrow({ where: { organizationId } });
  }
}

/** Payment replay and refunds reconcile one durable grant; refunds can never be re-credited. */
export async function reconcileCreditPurchase(
  prisma: PrismaClient,
  organizationId: string,
  purchase: BillingCreditPurchase,
  now = new Date(),
) {
  if (!Number.isSafeInteger(purchase.amountCents) || purchase.amountCents < 0)
    throw new Error("Invalid credit purchase");
  const expiresAt = purchase.expiresAt === undefined ? undefined : new Date(purchase.expiresAt);
  if (expiresAt && !Number.isFinite(expiresAt.getTime()))
    throw new Error("Invalid credit expiration");
  const delta = await reconcileCreditGrantMicros(
    prisma,
    organizationId,
    { id: purchase.id, amountMicros: BigInt(purchase.amountCents) * 10_000n, expiresAt },
    now,
  );
  return Number(delta);
}

/**
 * The grant itself, in micro-dollars: a grant for `purchase:<id>` is created, or shrunk to a smaller
 * amount (never grown), and the change in the balance is returned. A grant in another currency is
 * converted by the caller, which keeps the conversion on its own record.
 */
export async function reconcileCreditGrantMicros(
  prisma: PrismaClient,
  organizationId: string,
  grant: { id: string; amountMicros: bigint; expiresAt?: Date },
  now = new Date(),
): Promise<bigint> {
  if (grant.amountMicros < 0n) throw new Error("Invalid credit purchase");
  await creditAccount(prisma, organizationId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId" = ${organizationId} FOR UPDATE`;
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
    const source = `purchase:${grant.id}`;
    const existing = await tx.modelCreditEntry.findUnique({ where: { source } });
    if (existing && existing.organizationId !== organizationId)
      throw new Error("Credit purchase belongs to another account");
    if (!existing && grant.amountMicros === 0n) return 0n;
    const paid = grant.amountMicros;
    const amountMicros = existing && existing.amountMicros < paid ? existing.amountMicros : paid;
    const delta = amountMicros - (existing?.amountMicros ?? 0n);
    const expiresAt = grant.expiresAt;
    const previousLot = existing
      ? await tx.modelCreditLot.findUnique({ where: { id: existing.id } })
      : null;
    if (
      existing &&
      delta === 0n &&
      previousLot &&
      (!expiresAt || previousLot.expiresAt?.getTime() === expiresAt.getTime())
    )
      return 0n;
    const entry = await tx.modelCreditEntry.upsert({
      where: { source },
      create: { source, organizationId, amountMicros },
      update: { amountMicros },
    });
    if (delta !== 0n)
      await tx.modelCreditAccount.update({
        where: { organizationId },
        data: { balanceMicros: { increment: delta } },
      });
    await tx.modelCreditLot.upsert({
      where: { id: entry.id },
      create: {
        id: entry.id,
        organizationId,
        amountMicros,
        availableMicros: amountMicros,
        expiresAt,
      },
      update: {},
    });
    await resizeCreditLot(tx, entry.id, amountMicros, expiresAt);
    await syncLotBalance(tx, organizationId);
    await expireCreditLots(tx, organizationId, now);
    return delta;
  });
}

/** Start of the UTC day a bot's daily limit counts from. */
export function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * What a bot's runs have taken from hosted credits since a moment: settled calls at their real
 * cost and calls still in flight at the amount held for them. Refunds and grants are not spend.
 */
export async function botCreditSpendMicros(prisma: PrismaClient, botId: string, since: Date) {
  const rows = await prisma.$queryRaw<{ spent: bigint | null }[]>`
    SELECT COALESCE(SUM(-e."amountMicros"), 0)::bigint AS spent
    FROM model_credit_entries e
    JOIN runs r ON r."id" = e."runId"
    WHERE r."botId" = ${botId} AND e."callId" IS NOT NULL
      AND e."amountMicros" < 0 AND e."createdAt" >= ${since}`;
  return rows[0]?.spent ?? 0n;
}

/** Atomic debit prevents concurrent calls from reserving the same available funds. */
export async function reserveModelCredits(
  prisma: PrismaClient,
  organizationId: string,
  maxCostUsd: number,
  attribution?: {
    callId?: string;
    userId?: string;
    spaceId?: string;
    runId?: string;
    provider?: string;
    model?: string;
  },
  now = new Date(),
) {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 10_000)
    throw new Error("This model has no reliable price. Connect your own API key to use it.");
  const amountMicros = BigInt(Math.ceil(maxCostUsd * MICROS_PER_DOLLAR));
  const callId = attribution?.callId ?? randomUUID();
  const source = `call:${callId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${organizationId} FOR UPDATE`;
    const existing = await tx.modelCreditEntry.findUnique({ where: { callId } });
    if (existing) {
      if (existing.organizationId !== organizationId)
        throw new Error("Model call belongs to another account");
      return existing.id;
    }
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
    const reserved = await tx.modelCreditAccount.updateMany({
      where: { organizationId, mode: "credits", balanceMicros: { gte: amountMicros } },
      data: { balanceMicros: { decrement: amountMicros } },
    });
    if (reserved.count !== 1)
      throw new Error(
        "Not enough model credits. Add credits in Billing or connect your own API key.",
      );
    const allocations = await allocateCreditLots(tx, organizationId, amountMicros, now);
    return (
      await tx.modelCreditEntry.create({
        data: {
          ...attribution,
          id: callId,
          callId,
          source,
          organizationId,
          amountMicros: -amountMicros,
          pending: true,
          allocations,
          fundedMicros: allocatedMicros(allocations),
          reconciliationState: "pending",
          nextReconcileAt: new Date(Date.now() + 5 * 60_000),
        },
      })
    ).id;
  });
}

/**
 * Sets credit aside under a name of the caller's own, such as the amount a partner passes on to a
 * customer. It takes from the account's credit lots like a model call does but is final at once:
 * no model reports a cost for it, so the background reconciler never looks at it. Holding the same
 * name again changes nothing, and the balance is never taken below zero.
 */
export async function holdCredits(
  prisma: PrismaClient,
  organizationId: string,
  id: string,
  amountMicros: bigint,
  now = new Date(),
): Promise<"held" | "exists" | "insufficient"> {
  if (amountMicros <= 0n) throw new Error("Invalid credit hold");
  const source = `hold:${id}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${organizationId} FOR UPDATE`;
    const existing = await tx.modelCreditEntry.findUnique({ where: { source } });
    if (existing) {
      if (existing.organizationId !== organizationId)
        throw new Error("Credit hold belongs to another account");
      return "exists";
    }
    // An organization that never had credit has no account, which is a zero balance.
    if (!(await tx.modelCreditAccount.findUnique({ where: { organizationId } })))
      return "insufficient";
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
    const reserved = await tx.modelCreditAccount.updateMany({
      where: { organizationId, mode: "credits", balanceMicros: { gte: amountMicros } },
      data: { balanceMicros: { decrement: amountMicros } },
    });
    if (reserved.count !== 1) return "insufficient";
    const allocations = await allocateCreditLots(tx, organizationId, amountMicros, now);
    await tx.modelCreditEntry.create({
      data: {
        source,
        organizationId,
        amountMicros: -amountMicros,
        allocations,
        fundedMicros: allocatedMicros(allocations),
      },
    });
    await syncLotBalance(tx, organizationId);
    return "held";
  });
}

/** The caller can combine usage insertion and settlement in the same transaction. */
export async function settleModelCreditsTx(
  tx: Prisma.TransactionClient,
  reservationId: string,
  costUsd: number | null,
  reconcile = false,
  now = new Date(),
) {
  if (costUsd === null) return;
  if (!Number.isFinite(costUsd) || costUsd < 0) throw new Error("Invalid model cost");
  const scope = await tx.modelCreditEntry.findUnique({ where: { id: reservationId } });
  if (!scope) return;
  await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${scope.organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM model_credit_entries WHERE id=${reservationId} FOR UPDATE`;
  await prepareCreditLots(tx, scope.organizationId, now);
  await expireCreditLots(tx, scope.organizationId, now);
  const entry = await tx.modelCreditEntry.findUnique({ where: { id: reservationId } });
  if (!entry || (!entry.pending && !reconcile)) return;
  const amountMicros = -BigInt(Math.ceil(costUsd * MICROS_PER_DOLLAR));
  if (!entry.pending && amountMicros === entry.amountMicros) return;
  let allocations = (entry.allocations ?? []) as CreditAllocation[];
  const difference = amountMicros - entry.amountMicros;
  if (difference > 0n) {
    const funded = allocatedMicros(allocations);
    const unfunded = -entry.amountMicros - funded;
    const refund = difference - (unfunded > 0n ? unfunded : 0n);
    if (refund > 0n) allocations = await returnCreditLots(tx, allocations, refund, now);
  } else if (difference < 0n) {
    allocations.push(...(await allocateCreditLots(tx, entry.organizationId, -difference, now)));
  }
  await tx.modelCreditEntry.update({
    where: { id: reservationId },
    data: { pending: false, amountMicros, allocations, fundedMicros: allocatedMicros(allocations) },
  });
  await tx.modelCreditAccount.update({
    where: { organizationId: entry.organizationId },
    data: { balanceMicros: { increment: amountMicros - entry.amountMicros } },
  });
  await syncLotBalance(tx, entry.organizationId);
}

/** Unknown usage leaves a visible hold; no timeout can invent a zero-cost result. */
export function settleModelCredits(
  prisma: PrismaClient,
  reservationId: string,
  costUsd: number | null,
  now = new Date(),
) {
  return prisma.$transaction((tx) => settleModelCreditsTx(tx, reservationId, costUsd, false, now));
}

/** A provider cost or a proven pre-generation stop can finalize accounting. */
export function hasFinalModelCost(
  usage: Pick<AgentUsage, "costUsd" | "costSource" | "usageSource">,
): boolean {
  return (
    usage.costUsd != null &&
    Number.isFinite(usage.costUsd) &&
    usage.costUsd >= 0 &&
    (usage.costSource === "provider-reported" ||
      (usage.costUsd === 0 &&
        ["not-started", "provider-rejected"].includes(usage.usageSource ?? "")))
  );
}

/** Persist a receipt before attempting the canonical usage + settlement transaction. */
export async function recordModelCreditReceipt(
  prisma: PrismaClient,
  id: string,
  usage: AgentUsage | null,
) {
  if (!usage) return;
  await prisma.modelCreditEntry.updateMany({
    where: { id, pending: true },
    data: {
      usage: JSON.parse(JSON.stringify(usage)),
      ...(usage.providerRequestId ? { providerRequestId: usage.providerRequestId } : {}),
    },
  });
  if (
    usage.costUsd === 0 &&
    (usage.usageSource === "not-started" || usage.usageSource === "provider-rejected")
  )
    await prisma.$transaction(async (tx) => {
      await settleModelCreditsTx(tx, id, 0);
      await tx.modelCreditEntry.updateMany({
        where: { id, reconciliationState: "pending" },
        data: { nextReconcileAt: new Date() },
      });
    });
}

/** Also called by billing reads and the background reconciler when no new invoice arrives. */
export async function expireModelCredits(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "organizationId" FROM model_credit_accounts WHERE "organizationId"=${organizationId} FOR UPDATE`;
    const account = await tx.modelCreditAccount.findUnique({ where: { organizationId } });
    if (!account) return;
    await prepareCreditLots(tx, organizationId, now);
    await expireCreditLots(tx, organizationId, now);
  });
}
