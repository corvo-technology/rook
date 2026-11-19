import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/** A partner's test customers used the day's model calls; the next day starts again. */
export class PartnerTestCapReached extends Error {
  constructor() {
    super("partner_test_cap_reached");
    this.name = "PartnerTestCapReached";
  }
}

export const partnerTestDay = (now: Date) => now.toISOString().slice(0, 10);

/** True when the organization is a customer made with a partner's test key. */
export async function isPartnerTestOrganization(
  prisma: PrismaClient,
  organizationId: string,
): Promise<boolean> {
  return runAsSystem("partner test mode check", async () => {
    const tenant = await prisma.partnerTenant.findUnique({
      where: { organizationId },
      select: { testMode: true },
    });
    return tenant?.testMode === true;
  });
}

/** The same for a space, which is how a run names its customer. */
export async function isPartnerTestSpace(prisma: PrismaClient, spaceId: string): Promise<boolean> {
  return runAsSystem("partner test mode check", async () => {
    const tenant = await prisma.partnerTenant.findFirst({
      where: { testMode: true, organization: { spaces: { some: { id: spaceId } } } },
      select: { id: true },
    });
    return tenant !== null;
  });
}

/**
 * Counts one model call of a test customer against its partner's cap for the day and says whether
 * the organization is a test customer. Refuses with PartnerTestCapReached when the cap is used.
 * The count only moves while it is under the cap, so a refused call is not counted and two calls
 * at once cannot both take the last place.
 */
export async function takePartnerTestCall(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date(),
): Promise<boolean> {
  return runAsSystem("partner test call cap", async () => {
    const tenant = await prisma.partnerTenant.findUnique({
      where: { organizationId },
      select: { testMode: true, partnerId: true, partner: { select: { testDailyCap: true } } },
    });
    if (!tenant?.testMode) return false;
    const key = { partnerId: tenant.partnerId, day: partnerTestDay(now) };
    await prisma.partnerTestUsage.upsert({
      where: { partnerId_day: key },
      create: { ...key, calls: 0 },
      update: {},
    });
    const taken = await prisma.partnerTestUsage.updateMany({
      where: { ...key, calls: { lt: tenant.partner.testDailyCap } },
      data: { calls: { increment: 1 } },
    });
    if (taken.count !== 1) throw new PartnerTestCapReached();
    return true;
  });
}

/** A partner's test model calls today against its cap. */
export async function partnerTestUsageToday(
  prisma: PrismaClient,
  partnerId: string,
  now = new Date(),
): Promise<{ calls: number; cap: number }> {
  const [partner, usage] = await Promise.all([
    prisma.partner.findUniqueOrThrow({ where: { id: partnerId }, select: { testDailyCap: true } }),
    prisma.partnerTestUsage.findUnique({
      where: { partnerId_day: { partnerId, day: partnerTestDay(now) } },
      select: { calls: true },
    }),
  ]);
  return { calls: usage?.calls ?? 0, cap: partner.testDailyCap };
}

/** Sets how many model calls a partner's test customers may make per UTC day. */
export async function setPartnerTestDailyCap(
  prisma: PrismaClient,
  partnerId: string,
  cap: number,
): Promise<void> {
  if (!Number.isSafeInteger(cap) || cap < 0 || cap > 1_000_000) {
    throw new Error("The daily cap is a whole number from 0 to 1000000");
  }
  const result = await prisma.partner.updateMany({
    where: { id: partnerId },
    data: { testDailyCap: cap },
  });
  if (result.count === 0) throw new Error("Unknown partner");
}

/** The partner's test customers, so their data can be wiped. */
export function listPartnerTestTenants(prisma: PrismaClient, partnerId: string) {
  return prisma.partnerTenant.findMany({
    where: { partnerId, testMode: true },
    select: { id: true, externalTenantId: true, organizationId: true, ownerUserId: true },
    take: 1000,
  });
}

/**
 * Removes test customers whose content is already gone: their record, organization and owner.
 * Never touches a live customer. Returns how many were removed.
 */
export async function removePartnerTestTenants(
  prisma: PrismaClient,
  partnerId: string,
  tenants: ReadonlyArray<{ organizationId: string; ownerUserId: string }>,
): Promise<number> {
  let removed = 0;
  for (const tenant of tenants) {
    const gone = await prisma.partnerTenant.deleteMany({
      where: { partnerId, testMode: true, organizationId: tenant.organizationId },
    });
    if (gone.count === 0) continue;
    await prisma.organization.deleteMany({ where: { id: tenant.organizationId } });
    await prisma.user.deleteMany({ where: { id: tenant.ownerUserId } });
    removed += 1;
  }
  return removed;
}
