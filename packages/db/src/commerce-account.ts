import type { PrismaClient } from "./client.js";
import { commerceBalance } from "./commerce-ledger.js";
import { partnerCheckoutUrl } from "./partners.js";

export interface PartnerBalanceView {
  currency: "BRL" | "USD";
  planName: string | null;
  planCredit: number;
  used: number;
  remaining: number;
  topupRemaining: number;
  periodEnd: string | null;
  state: "active" | "past_due" | "lapsed";
  checkoutUrl: string | null;
  lowThresholdReached: boolean;
}

/**
 * What a commerce customer sees of its own balance: null for an organization that is not a
 * commerce partner's customer. It never reads another customer: the organization decides.
 * Call with a client that runs as the system.
 */
export async function partnerBalanceForOrganization(
  prisma: PrismaClient,
  organizationId: string,
  options: { pack?: string; now?: Date } = {},
): Promise<PartnerBalanceView | null> {
  const tenant = await prisma.partnerTenant.findUnique({
    where: { organizationId },
    include: { partner: true },
  });
  if (tenant?.partner.billingModel !== "commerce") return null;
  const balance = await commerceBalance(prisma, tenant.partner, tenant, options.now);
  return {
    currency: balance.currency === "BRL" ? "BRL" : "USD",
    planName: balance.planName,
    planCredit: balance.plan.grantedMinor,
    used: balance.plan.usedMinor,
    remaining: balance.plan.remainingMinor,
    topupRemaining: balance.topup.remainingMinor,
    periodEnd: balance.periodEnd?.toISOString() ?? null,
    // A canceled plan works until its period ends; no plan at all is as good as a lapsed one.
    state:
      balance.state === "canceled" ? "active" : balance.state === "none" ? "lapsed" : balance.state,
    checkoutUrl: partnerCheckoutUrl(
      tenant.partner.checkoutUrl,
      tenant.externalTenantId,
      options.pack,
    ),
    lowThresholdReached: balance.lowThresholdReached,
  };
}
