import type { PlatformPartner } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { partnerWalletOrganization } from "./partner-wallet.js";

const MICROS_PER_CREDIT = 10_000n;
const MAX_ENTRIES = 50_000;

/** The month's bounds, UTC; the current month when `period` is left out. */
function monthBounds(period: string | undefined, now: Date) {
  const [year, month] = period
    ? period.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(year as number, (month as number) - 1, 1));
  return { start, end: new Date(Date.UTC(year as number, month as number, 1)) };
}

/**
 * Every partner with its customers' use of the fund in a month against what the providers charged
 * for it. Read-only and numbers only. Call with a client that runs as the system.
 */
export async function platformPartnerOverview(
  prisma: PrismaClient,
  period: string | undefined,
  now = new Date(),
): Promise<PlatformPartner[]> {
  const { start, end } = monthBounds(period, now);
  const partners = await prisma.partner.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      mode: true,
      planKey: true,
      plan: { select: { tierKey: true, status: true } },
    },
  });
  const rows: PlatformPartner[] = [];
  for (const partner of partners) {
    const tenants = await prisma.partnerTenant.findMany({
      where: { partnerId: partner.id },
      select: { organizationId: true, state: true },
    });
    const organizations = tenants.map((tenant) => tenant.organizationId);
    const [entries, walletOrganization] = await Promise.all([
      organizations.length
        ? prisma.modelCreditEntry.findMany({
            where: {
              organizationId: { in: organizations },
              amountMicros: { lt: 0n },
              pending: false,
              createdAt: { gte: start, lt: end },
            },
            select: { amountMicros: true, usage: true },
            take: MAX_ENTRIES,
          })
        : [],
      partnerWalletOrganization(prisma, partner.id),
    ]);
    const account = walletOrganization
      ? await prisma.modelCreditAccount.findUnique({
          where: { organizationId: walletOrganization },
          select: { balanceMicros: true },
        })
      : null;
    let charged = 0n;
    let costUsd = 0;
    let reported = false;
    for (const entry of entries) {
      charged += -entry.amountMicros;
      const cost = (entry.usage as { costUsd?: unknown } | null)?.costUsd;
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
        costUsd += cost;
        reported = true;
      }
    }
    const balance = Number((account?.balanceMicros ?? 0n) / MICROS_PER_CREDIT);
    const chargedCredits = Number(charged / MICROS_PER_CREDIT);
    const total = Math.max(balance, 0) + chargedCredits;
    rows.push({
      id: partner.id,
      slug: partner.slug,
      name: partner.name,
      mode:
        partner.mode === "white_label" || partner.mode === "referral" ? partner.mode : "embedded",
      // The plan it is on; before the owner has a fund to credit, the one it was approved for.
      plan: partner.plan
        ? partner.plan.status === "active"
          ? partner.plan.tierKey
          : null
        : (partner.planKey ?? null),
      activeCustomers: tenants.filter((tenant) => tenant.state === "enabled").length,
      fundBalanceCredits: balance,
      fundPercent: total > 0 ? Math.round((Math.max(balance, 0) / total) * 100) : null,
      chargedCredits,
      costCredits: reported ? Math.round(costUsd * 100) : null,
    });
  }
  return rows;
}
