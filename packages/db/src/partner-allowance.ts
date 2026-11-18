import { createHash } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { reconcileCreditPurchase } from "./model-credits.js";
import { reservePartnerAllowance } from "./partner-wallet.js";

const MICROS_PER_CENT = 10_000n;
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

const allowancePrefix = (tenant: { partnerId: string; externalTenantId: string }, period: string) =>
  `partner:${tenant.partnerId}:${tenant.externalTenantId}:${period}`;

/**
 * Sets a partner customer's credit for a calendar month, using the same grant that pays for a
 * purchase. The credit expires when the month ends. Granting the same amount again changes
 * nothing; a larger amount adds only the difference as one more grant; a smaller amount never
 * takes credit back. The first grant and each raise have their own identity, so a repeated call
 * (even two at once) cannot add twice. Call with a client that runs as the system.
 */
export async function grantPartnerAllowance(
  prisma: PrismaClient,
  tenant: { organizationId: string; partnerId: string; externalTenantId: string },
  input: { amountCents: number; period: string },
): Promise<{ addedCents: number }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("The allowance must be a whole, positive number of cents");
  }
  const month = PERIOD.exec(input.period);
  if (!month) throw new Error("The period must be a month such as 2026-11");
  // The month index of the next month, so this is the first instant after the period.
  const expiresAt = new Date(Date.UTC(Number(month[1]), Number(month[2]), 1)).toISOString();

  const prefix = allowancePrefix(tenant, input.period);
  // A grant is stored under the source `purchase:<id>`.
  const granted = await prisma.modelCreditEntry.aggregate({
    _sum: { amountMicros: true },
    where: { organizationId: tenant.organizationId, source: { startsWith: `purchase:${prefix}:` } },
  });
  const grantedCents = Number((granted._sum.amountMicros ?? 0n) / MICROS_PER_CENT);
  const missing = input.amountCents - grantedCents;
  if (missing <= 0) return { addedCents: 0 };

  const id = grantedCents === 0 ? `${prefix}:base` : `${prefix}:raise:${input.amountCents}`;
  await reservePartnerAllowance(prisma, tenant, {
    holdId: id,
    period: input.period,
    totalCents: input.amountCents,
    missingCents: missing,
  });
  const addedMicros = await reconcileCreditPurchase(prisma, tenant.organizationId, {
    id,
    amountCents: missing,
    expiresAt,
  });
  return { addedCents: Math.round(addedMicros / Number(MICROS_PER_CENT)) };
}

/**
 * Adds credit to a customer on top of this month's allowance (a console or agent gift), paid from
 * the partner's own credit like the allowance itself and given back with it when unused. The same
 * `key` adds it once: the grant and its hold share a name made from the key. Call with a client
 * that runs as the system.
 */
export async function addPartnerAllowance(
  prisma: PrismaClient,
  tenant: { organizationId: string; partnerId: string; externalTenantId: string },
  input: { amountCents: number; period: string; key: string },
): Promise<{ addedCents: number }> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("The credit must be a whole, positive number of cents");
  }
  const month = PERIOD.exec(input.period);
  if (!month) throw new Error("The period must be a month such as 2026-11");
  const expiresAt = new Date(Date.UTC(Number(month[1]), Number(month[2]), 1)).toISOString();
  const prefix = allowancePrefix(tenant, input.period);
  // The name ends in digits so the sweep that gives unused credit back reads it as a raise.
  const digits = BigInt(`0x${createHash("sha256").update(input.key).digest("hex").slice(0, 12)}`);
  const id = `${prefix}:raise:${digits}`;
  const [again, monthTotal] = await Promise.all([
    prisma.modelCreditEntry.findUnique({
      where: { source: `purchase:${id}` },
      select: { id: true },
    }),
    prisma.modelCreditEntry.aggregate({
      _sum: { amountMicros: true },
      where: {
        organizationId: tenant.organizationId,
        source: { startsWith: `purchase:${prefix}:` },
      },
    }),
  ]);
  if (again) return { addedCents: 0 };
  const grantedCents = Number((monthTotal._sum.amountMicros ?? 0n) / MICROS_PER_CENT);
  await reservePartnerAllowance(prisma, tenant, {
    holdId: id,
    period: input.period,
    totalCents: grantedCents + input.amountCents,
    missingCents: input.amountCents,
  });
  const addedMicros = await reconcileCreditPurchase(prisma, tenant.organizationId, {
    id,
    amountCents: input.amountCents,
    expiresAt,
  });
  return { addedCents: Math.round(addedMicros / Number(MICROS_PER_CENT)) };
}
