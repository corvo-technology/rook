import { randomBytes } from "node:crypto";
import { generatePartnerKey } from "@corvo/core/node/partner-key";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import type { Partner } from "./generated/prisma/client.js";
import { ensurePartnerMember } from "./partners.js";

/** These manage a partner by the person who owns it. Call with a client that runs as the system. */

export async function createOwnedPartner(
  prisma: PrismaClient,
  userId: string,
  name: string,
): Promise<{ partner: Partner; key: string }> {
  const issued = generatePartnerKey();
  try {
    const partner = await prisma.partner.create({
      data: {
        slug: `p-${randomBytes(6).toString("hex")}`,
        name: name.trim(),
        keyPrefix: issued.prefix,
        keyHash: issued.hash,
        ownerUserId: userId,
      },
    });
    await ensurePartnerMember(prisma, partner);
    return { partner, key: issued.key };
  } catch (error) {
    if ((error as { code?: unknown })?.code === "P2002") throw new Error("Already a partner");
    throw error;
  }
}

export function findOwnedPartner(prisma: PrismaClient, userId: string): Promise<Partner | null> {
  return prisma.partner.findUnique({ where: { ownerUserId: userId } });
}

/** The old key stops working in the same statement that stores the new one. */
export async function rotateOwnedPartnerKey(
  prisma: PrismaClient,
  userId: string,
): Promise<{ partner: Partner; key: string }> {
  const issued = generatePartnerKey();
  const result = await prisma.partner.updateMany({
    where: { ownerUserId: userId },
    data: { keyPrefix: issued.prefix, keyHash: issued.hash },
  });
  if (result.count === 0) throw new Error("Not a partner");
  return {
    partner: await prisma.partner.findUniqueOrThrow({ where: { ownerUserId: userId } }),
    key: issued.key,
  };
}

export async function listOwnedPartnerTenants(
  prisma: PrismaClient,
  partnerId: string,
  now = new Date(),
): Promise<
  Array<{
    externalTenantId: string;
    name: string;
    state: string;
    usedUsd: number;
    balanceUsd: number;
  }>
> {
  const rows = await prisma.partnerTenant.findMany({
    where: { partnerId },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      externalTenantId: true,
      state: true,
      organizationId: true,
      organization: { select: { name: true } },
    },
  });
  const organizationIds = rows.map((row) => row.organizationId);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [spent, accounts] = await Promise.all([
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
  const usedBy = new Map(spent.map((row) => [row.organizationId, row._sum.amountMicros ?? 0n]));
  const balanceBy = new Map(accounts.map((row) => [row.organizationId, row.balanceMicros]));
  const dollars = (micros: bigint) => Number(micros) / 1_000_000;
  return rows.map((row) => ({
    externalTenantId: row.externalTenantId,
    name: row.organization.name,
    state: row.state,
    usedUsd: dollars(-(usedBy.get(row.organizationId) ?? 0n)),
    balanceUsd: dollars(balanceBy.get(row.organizationId) ?? 0n),
  }));
}

/** Stores a partner's template by its id, or removes it with null. */
export async function setPartnerTemplateById(
  prisma: PrismaClient,
  partnerId: string,
  template: unknown | null,
): Promise<void> {
  await prisma.partner.update({
    where: { id: partnerId },
    data: { template: template === null ? Prisma.DbNull : (template as Prisma.InputJsonValue) },
  });
}

/** Stores what every new customer of the partner gets, or removes it with null. */
export async function setOwnedPartnerTemplate(
  prisma: PrismaClient,
  userId: string,
  template: unknown | null,
): Promise<boolean> {
  const result = await prisma.partner.updateMany({
    where: { ownerUserId: userId },
    data: { template: template === null ? Prisma.DbNull : (template as Prisma.InputJsonValue) },
  });
  return result.count > 0;
}
