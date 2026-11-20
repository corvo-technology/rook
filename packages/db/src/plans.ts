import type { ComputerSize, PlanConfig, PlanEntitlements, PlanOverride } from "@corvo/contracts";
import { ComputerSizeSchema, resolveEntitlements } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/** The limits an organization has under the configured plans, or null without plans (self-hosted). */
export async function organizationEntitlements(
  prisma: Pick<PrismaClient, "billingAccount" | "organizationLimitOverride">,
  config: PlanConfig | undefined,
  organizationId: string,
): Promise<PlanEntitlements | null> {
  if (!config) return null;
  const [billing, override] = await Promise.all([
    prisma.billingAccount.findUnique({
      where: { organizationId },
      select: { status: true, priceId: true, priceLookupKey: true },
    }),
    organizationOverride(prisma, organizationId),
  ]);
  return resolveEntitlements(config, billing, override);
}

/** The platform owner's custom limits for the organization, or null. */
export async function organizationOverride(
  prisma: Pick<PrismaClient, "organizationLimitOverride">,
  organizationId: string,
): Promise<PlanOverride | null> {
  const row = await prisma.organizationLimitOverride.findUnique({ where: { organizationId } });
  if (!row) return null;
  const size = ComputerSizeSchema.safeParse(row.computerSize);
  return {
    ...(size.success ? { computerSize: size.data } : {}),
    ...(row.computers !== null ? { computers: row.computers } : {}),
    ...(row.storageGb !== null ? { storageGb: row.storageGb } : {}),
    ...(row.maxSeats !== null ? { maxSeats: row.maxSeats } : {}),
  };
}

/** Sets the organization's custom limits, replacing any set before; an empty one clears them. */
export async function setOrganizationOverride(
  prisma: Pick<PrismaClient, "organizationLimitOverride">,
  input: { organizationId: string; override: PlanOverride; updatedByUserId: string },
): Promise<void> {
  const o = input.override;
  if (Object.values(o).every((value) => value === undefined)) {
    await prisma.organizationLimitOverride.deleteMany({
      where: { organizationId: input.organizationId },
    });
    return;
  }
  const data = {
    computerSize: o.computerSize ?? null,
    computers: o.computers ?? null,
    storageGb: o.storageGb ?? null,
    maxSeats: o.maxSeats ?? null,
    updatedByUserId: input.updatedByUserId,
  };
  await prisma.organizationLimitOverride.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...data },
    update: data,
  });
}

export async function organizationIdOfSpace(
  prisma: Pick<PrismaClient, "space">,
  spaceId: string,
): Promise<string | null> {
  const space = await runAsSystem("space organization for plan limits", () =>
    prisma.space.findUnique({ where: { id: spaceId }, select: { organizationId: true } }),
  );
  return space?.organizationId ?? null;
}

/** The limits of the organization that owns the space, or null when there are none. */
export async function spaceEntitlements(
  prisma: Pick<PrismaClient, "space" | "billingAccount" | "organizationLimitOverride">,
  config: PlanConfig | undefined,
  spaceId: string,
): Promise<PlanEntitlements | null> {
  if (!config) return null;
  const organizationId = await organizationIdOfSpace(prisma, spaceId);
  return organizationId ? organizationEntitlements(prisma, config, organizationId) : null;
}

/** The size a computer in this space starts at under the plan; undefined without plans. */
export async function spaceComputerSize(
  prisma: Pick<PrismaClient, "space" | "billingAccount" | "organizationLimitOverride">,
  config: PlanConfig | undefined,
  spaceId: string,
): Promise<ComputerSize | undefined> {
  return (await spaceEntitlements(prisma, config, spaceId))?.computerSize;
}
