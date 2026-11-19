import type { PartnerWebhookEventType } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";

const MICROS_PER_CENT = 10_000n;
/** How long an undelivered notice is still worth retrying. */
const RETRY_FOR_MS = 3 * 24 * 60 * 60_000;

const periodOf = (now: Date) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Finds the customers of partners with a webhook that have used 80% of this month's credit, or
 * all of it, and records one notice for each, once per month. Returns the notices made by this
 * call, so only they are queued. Call with a client that runs as the system.
 */
export async function claimPartnerAllowanceNotices(
  prisma: PrismaClient,
  now = new Date(),
): Promise<string[]> {
  const period = periodOf(now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const partners = await prisma.partner.findMany({
    where: { enabled: true, webhookUrl: { not: null } },
    select: { id: true },
    take: 100,
  });
  const made: string[] = [];
  for (const partner of partners) {
    const tenants = await prisma.partnerTenant.findMany({
      where: { partnerId: partner.id, state: "enabled", testMode: false },
      select: { externalTenantId: true, organizationId: true },
      take: 1000,
    });
    if (tenants.length === 0) continue;
    const organizationIds = tenants.map((tenant) => tenant.organizationId);
    const [granted, spent, accounts] = await Promise.all([
      prisma.modelCreditEntry.groupBy({
        by: ["organizationId"],
        where: {
          organizationId: { in: organizationIds },
          source: { startsWith: `purchase:partner:${partner.id}:`, contains: `:${period}:` },
        },
        _sum: { amountMicros: true },
      }),
      prisma.modelCreditEntry.groupBy({
        by: ["organizationId"],
        where: {
          organizationId: { in: organizationIds },
          amountMicros: { lt: 0n },
          createdAt: { gte: monthStart },
        },
        _sum: { amountMicros: true },
      }),
      prisma.modelCreditAccount.findMany({
        where: { organizationId: { in: organizationIds } },
        select: { organizationId: true, balanceMicros: true },
      }),
    ]);
    const grantedBy = new Map(
      granted.map((row) => [row.organizationId, row._sum.amountMicros ?? 0n]),
    );
    const spentBy = new Map(
      spent.map((row) => [row.organizationId, -(row._sum.amountMicros ?? 0n)]),
    );
    const balanceBy = new Map(accounts.map((row) => [row.organizationId, row.balanceMicros]));
    for (const tenant of tenants) {
      const grantedMicros = grantedBy.get(tenant.organizationId) ?? 0n;
      if (grantedMicros <= 0n) continue;
      const usedMicros = spentBy.get(tenant.organizationId) ?? 0n;
      const exhausted =
        (balanceBy.get(tenant.organizationId) ?? 0n) <= 0n || usedMicros >= grantedMicros;
      // 80% of the credit it was given, without rounding.
      const low = usedMicros * 10n >= grantedMicros * 8n;
      const kind: PartnerWebhookEventType | null = exhausted
        ? "tenant.allowance_exhausted"
        : low
          ? "tenant.allowance_low"
          : null;
      if (!kind) continue;
      try {
        const row = await prisma.partnerWebhookEvent.create({
          data: {
            partnerId: partner.id,
            externalTenantId: tenant.externalTenantId,
            kind,
            period,
            grantedCents: Number(grantedMicros / MICROS_PER_CENT),
            usedCents: Number(usedMicros / MICROS_PER_CENT),
          },
          select: { id: true },
        });
        made.push(row.id);
      } catch (error) {
        // Already told for this customer, kind and month.
        if ((error as { code?: unknown })?.code !== "P2002") throw error;
      }
    }
  }
  return made;
}

/** Notices not yet delivered, so a lost job is queued again. Newest first, bounded. */
export async function undeliveredPartnerWebhookEvents(
  prisma: PrismaClient,
  now = new Date(),
): Promise<string[]> {
  const rows = await prisma.partnerWebhookEvent.findMany({
    where: {
      deliveredAt: null,
      createdAt: {
        gte: new Date(now.getTime() - RETRY_FOR_MS),
        lte: new Date(now.getTime() - 15 * 60_000),
      },
      partner: {
        enabled: true,
        OR: [{ webhookUrl: { not: null } }, { testWebhookUrl: { not: null } }],
      },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
    take: 100,
  });
  return rows.map((row) => row.id);
}
