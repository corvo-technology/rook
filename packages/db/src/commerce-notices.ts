import type { PrismaClient } from "./client.js";
import { commerceSettings } from "./commerce-config.js";
import { commerceBalance, recordCommerceEvent } from "./commerce-ledger.js";
import { subscriptionState } from "./commerce-money.js";
import { expireModelCredits } from "./model-credits.js";

/**
 * Finds what commerce partners are owed a notice for and records each once: `subscription.lapsed`
 * when access ended without a renewal, `tenant.allowance_low` and `tenant.allowance_exhausted` for
 * the period's plan credit (80% used by default, once per period), and `credit.expired` when a
 * plan lot ended. A lapsed customer is also marked, so the partner is told once until a renewal.
 * Returns the notices made by this call. Call with a client that runs as the system.
 */
export async function claimCommerceNotices(
  prisma: PrismaClient,
  now = new Date(),
): Promise<string[]> {
  const partners = await prisma.partner.findMany({
    where: { enabled: true, billingModel: "commerce" },
    select: { id: true, currency: true, commissionBps: true, webhookUrl: true },
    take: 100,
  });
  const made: string[] = [];
  if (partners.length === 0) return made;
  const settings = await commerceSettings(prisma);
  for (const partner of partners) {
    const tenants = await prisma.partnerTenant.findMany({
      where: { partnerId: partner.id, testMode: false, subscription: { isNot: null } },
      include: { subscription: true },
      take: 1000,
    });
    for (const tenant of tenants) {
      const subscription = tenant.subscription!;
      const state = subscriptionState(subscription, now, settings.graceDays);
      const base = { id: tenant.id, organizationId: tenant.organizationId };
      const push = async (kind: string, key: string, payload: Record<string, unknown>) => {
        const id = await recordCommerceEvent(prisma, partner, {
          externalTenantId: tenant.externalTenantId,
          kind,
          key,
          payload,
        });
        if (id) made.push(id);
      };
      if (state === "lapsed" && !subscription.lapsedAt) {
        const marked = await prisma.tenantSubscription.updateMany({
          where: { id: subscription.id, lapsedAt: null },
          data: { lapsedAt: now },
        });
        if (marked.count === 1) {
          await push("subscription.lapsed", `${subscription.periodStart.toISOString()}:lapsed`, {
            plan: subscription.planKey,
            status: subscription.status,
            currency: partner.currency,
          });
        }
      }
      if (!partner.webhookUrl) continue;
      const balance = await commerceBalance(prisma, partner, base, now);
      if (balance.plan.grantedMinor <= 0 || !balance.period) continue;
      const payload = {
        period: balance.period,
        currency: partner.currency,
        grantedMinor: balance.plan.grantedMinor,
        usedMinor: balance.plan.usedMinor,
        remainingMinor: balance.remainingMinor,
      };
      if (balance.remainingMinor <= 0 && balance.plan.usedMinor > 0 && state !== "lapsed") {
        await push("tenant.allowance_exhausted", balance.period, payload);
      } else if (balance.lowThresholdReached && subscription.periodEnd > now) {
        await push("tenant.allowance_low", balance.period, payload);
      }
      if (subscription.periodEnd <= now) {
        const grants = await prisma.creditGrant.findMany({
          where: {
            partnerTenantId: tenant.id,
            kind: { in: ["plan", "plan_upgrade"] },
            expiresAt: { lte: now },
          },
        });
        if (grants.length > 0) await expireModelCredits(prisma, tenant.organizationId, now);
        for (const grant of grants) {
          const lot = await prisma.modelCreditEntry.findUnique({
            where: { source: `purchase:${grant.source}` },
            select: { id: true },
          });
          const row = lot
            ? await prisma.modelCreditLot.findUnique({ where: { id: lot.id } })
            : null;
          if (!row || row.expiredMicros <= 0n) continue;
          const expiredMinor = Number(
            (BigInt(grant.creditMinor) * row.expiredMicros) / row.amountMicros,
          );
          await push("credit.expired", `${grant.period}:${grant.source}`, {
            period: grant.period,
            currency: partner.currency,
            expiredMinor,
          });
        }
      }
    }
  }
  return made;
}
