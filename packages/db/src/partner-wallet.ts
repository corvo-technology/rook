import type { PrismaClient } from "./client.js";
import { expireModelCredits, holdCredits, reconcileCreditPurchase } from "./model-credits.js";

const MICROS_PER_CENT = 10_000n;

/** Why a partner's pass-on was not made: its credit is short, or it is over a limit it set. */
export class PartnerAllowanceRefused extends Error {
  constructor(readonly reason: "wallet" | "limit") {
    super(reason === "wallet" ? "The partner's credit is short" : "Over the partner's limit");
    this.name = "PartnerAllowanceRefused";
  }
}

/** The source of a customer's grant for a month: `purchase:partner:<partner>:<customer>:<month>:…`. */
const GRANT_SOURCE = /^purchase:partner:([^:]+):.+:\d{4}-(?:0[1-9]|1[0-2]):(?:base|raise:\d+)$/;

/**
 * The credit account that pays for a partner's customers: the one its owner buys credit for in
 * Billing. A partner made on the command line has no owner and draws on the account it was told
 * to (`walletOwnerUserId`); told none, it has no credit to pass on. Call with a client that runs
 * as the system.
 */
export async function partnerWalletOrganization(
  prisma: PrismaClient,
  partnerId: string,
): Promise<string | null> {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { ownerUserId: true, walletOwnerUserId: true },
  });
  const payer = partner?.ownerUserId ?? partner?.walletOwnerUserId;
  if (!payer) return null;
  const membership = await prisma.member.findFirst({
    where: { userId: payer, role: "owner" },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/** What the partner has passed on in a month so far, in micro-dollars. */
export async function partnerPassedOnMicros(
  prisma: PrismaClient,
  partnerId: string,
  organizationId: string,
  period: string,
): Promise<bigint> {
  const held = await prisma.modelCreditEntry.aggregate({
    _sum: { amountMicros: true },
    where: {
      organizationId,
      source: { startsWith: `hold:partner:${partnerId}:`, contains: `:${period}:` },
    },
  });
  return -(held._sum.amountMicros ?? 0n);
}

/**
 * Sets aside, from the partner's credit, the amount about to be passed on to a customer. Refuses
 * (and sets nothing aside) when the amount is over a limit the partner set or its credit is
 * short. The hold has the same name as the grant it pays for, so a repeated call, even at the same
 * instant, sets aside once and finishes the grant. A partner without an owner has no credit to
 * pass on, so it is refused like any partner whose credit is short.
 */
export async function reservePartnerAllowance(
  prisma: PrismaClient,
  tenant: { partnerId: string; externalTenantId: string },
  input: { holdId: string; period: string; totalCents: number; missingCents: number },
): Promise<void> {
  const organizationId = await partnerWalletOrganization(prisma, tenant.partnerId);
  if (!organizationId) throw new PartnerAllowanceRefused("wallet");
  const partner = await prisma.partner.findUniqueOrThrow({
    where: { id: tenant.partnerId },
    select: { perTenantLimitCents: true, monthlyLimitCents: true },
  });
  if (partner.perTenantLimitCents !== null && input.totalCents > partner.perTenantLimitCents) {
    throw new PartnerAllowanceRefused("limit");
  }
  if (partner.monthlyLimitCents !== null) {
    const passed = await partnerPassedOnMicros(
      prisma,
      tenant.partnerId,
      organizationId,
      input.period,
    );
    const held = await prisma.modelCreditEntry.findUnique({
      where: { source: `hold:${input.holdId}` },
      select: { id: true },
    });
    const next = passed + BigInt(input.missingCents) * MICROS_PER_CENT;
    if (!held && next > BigInt(partner.monthlyLimitCents) * MICROS_PER_CENT) {
      throw new PartnerAllowanceRefused("limit");
    }
  }
  const outcome = await holdCredits(
    prisma,
    organizationId,
    input.holdId,
    BigInt(input.missingCents) * MICROS_PER_CENT,
  );
  if (outcome === "insufficient") throw new PartnerAllowanceRefused("wallet");
}

/**
 * Gives back to the partner what its customers did not use of the credit it passed on, once each
 * customer's month has ended. Each lot of a customer's grant expires once and is returned once, by
 * name. Returns how many lots were returned in this run. Call with a client that runs as the system.
 */
export async function returnUnusedPartnerAllowance(
  prisma: PrismaClient,
  now = new Date(),
): Promise<number> {
  // Expiry is applied lazily; make sure the ended grants have been applied before reading them.
  const ended = await prisma.$queryRaw<Array<{ organizationId: string }>>`
    SELECT DISTINCT l."organizationId" FROM model_credit_lots l
    JOIN model_credit_entries e ON e.id = l.id
    WHERE e.source LIKE 'purchase:partner:%' AND l."expiresAt" <= ${now} AND l."availableMicros" > 0
    LIMIT 100`;
  for (const { organizationId } of ended) await expireModelCredits(prisma, organizationId, now);
  // Only grants not yet given back, so a busy deployment does not re-read the whole history.
  const open = await prisma.$queryRaw<Array<{ id: string; source: string; expired: bigint }>>`
    SELECT e.id, e.source, l."expiredMicros" AS expired FROM model_credit_lots l
    JOIN model_credit_entries e ON e.id = l.id
    WHERE e.source LIKE 'purchase:partner:%' AND l."expiresAt" <= ${now} AND l."expiredMicros" >= ${MICROS_PER_CENT}
      AND NOT EXISTS (
        SELECT 1 FROM model_credit_entries r WHERE r.source = 'purchase:partner-return:' || e.id)
    ORDER BY l."expiresAt" LIMIT 100`;
  let returned = 0;
  for (const grant of open) {
    const partnerId = GRANT_SOURCE.exec(grant.source)?.[1];
    if (!partnerId) continue;
    const organizationId = await partnerWalletOrganization(prisma, partnerId);
    if (!organizationId) continue;
    const added = await reconcileCreditPurchase(prisma, organizationId, {
      id: `partner-return:${grant.id}`,
      amountCents: Number(grant.expired / MICROS_PER_CENT),
    });
    if (added > 0) returned += 1;
  }
  return returned;
}

const dollars = (micros: bigint) => Number(micros) / 1_000_000;

export interface PartnerWalletSummary {
  balanceUsd: number;
  passedOnUsd: number;
  perTenantLimitUsd: number | null;
  monthlyLimitUsd: number | null;
}

/** What the partner sees of its credit this month; null for a partner not paid for from one. */
export async function partnerWalletSummary(
  prisma: PrismaClient,
  partnerId: string,
  period: string,
): Promise<PartnerWalletSummary | null> {
  const organizationId = await partnerWalletOrganization(prisma, partnerId);
  if (!organizationId) return null;
  const [account, passed, partner] = await Promise.all([
    prisma.modelCreditAccount.findUnique({
      where: { organizationId },
      select: { balanceMicros: true },
    }),
    partnerPassedOnMicros(prisma, partnerId, organizationId, period),
    prisma.partner.findUniqueOrThrow({
      where: { id: partnerId },
      select: { perTenantLimitCents: true, monthlyLimitCents: true },
    }),
  ]);
  return {
    balanceUsd: dollars(account?.balanceMicros ?? 0n),
    passedOnUsd: dollars(passed),
    perTenantLimitUsd:
      partner.perTenantLimitCents === null ? null : partner.perTenantLimitCents / 100,
    monthlyLimitUsd: partner.monthlyLimitCents === null ? null : partner.monthlyLimitCents / 100,
  };
}

/** Whole cents; a limit of null removes it. */
export async function setPartnerLimits(
  prisma: PrismaClient,
  partnerId: string,
  limits: { perTenantLimitUsd: number | null; monthlyLimitUsd: number | null },
): Promise<void> {
  const cents = (usd: number | null) => (usd === null ? null : Math.round(usd * 100));
  await prisma.partner.update({
    where: { id: partnerId },
    data: {
      perTenantLimitCents: cents(limits.perTenantLimitUsd),
      monthlyLimitCents: cents(limits.monthlyLimitUsd),
    },
  });
}
