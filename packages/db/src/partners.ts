import {
  generatePartnerKey,
  partnerKeyPrefix,
  verifyPartnerKey,
} from "@corvo/core/node/partner-key";
import type { Prisma, PrismaClient } from "./client.js";
import type { Partner } from "./generated/prisma/client.js";

/** Partner rows are internal: call these with a client that runs as the system. */
export async function createPartner(
  prisma: PrismaClient,
  input: { slug: string; name: string; walletOwnerUserId?: string },
): Promise<{ partner: Partner; key: string }> {
  const issued = generatePartnerKey();
  const partner = await prisma.partner.create({
    data: {
      slug: input.slug,
      name: input.name,
      ...(input.walletOwnerUserId ? { walletOwnerUserId: input.walletOwnerUserId } : {}),
      keyPrefix: issued.prefix,
      keyHash: issued.hash,
    },
  });
  return { partner, key: issued.key };
}

/** The old key stops working in the same statement that stores the new one. */
export async function rotatePartnerKey(
  prisma: PrismaClient,
  slug: string,
): Promise<{ partner: Partner; key: string }> {
  const issued = generatePartnerKey();
  const result = await prisma.partner.updateMany({
    where: { slug },
    data: { keyPrefix: issued.prefix, keyHash: issued.hash },
  });
  if (result.count === 0) throw new Error(`Unknown partner: ${slug}`);
  const partner = await prisma.partner.findUniqueOrThrow({ where: { slug } });
  return { partner, key: issued.key };
}

export async function setPartnerEnabled(
  prisma: PrismaClient,
  slug: string,
  enabled: boolean,
): Promise<void> {
  const result = await prisma.partner.updateMany({ where: { slug }, data: { enabled } });
  if (result.count === 0) throw new Error(`Unknown partner: ${slug}`);
}

/** The partner a key belongs to, or null for a key that is unknown, wrong or disabled. */
export async function authenticatePartner(
  prisma: PrismaClient,
  key: string,
): Promise<Partner | null> {
  const prefix = partnerKeyPrefix(key);
  if (prefix === null) return null;
  const partner = await prisma.partner.findUnique({ where: { keyPrefix: prefix } });
  if (!partner?.enabled || !verifyPartnerKey(key, partner.keyHash)) return null;
  return partner;
}

/** The account with this email, for naming whose credit pays for a partner. */
export async function findUserIdByEmail(
  prisma: PrismaClient,
  email: string,
): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Replaces what every new customer of the partner gets. Safe to repeat: the same template stored
 * again changes nothing. False when no partner has the slug.
 */
export async function setPartnerTemplateBySlug(
  prisma: PrismaClient,
  slug: string,
  template: unknown,
): Promise<boolean> {
  const result = await prisma.partner.updateMany({
    where: { slug },
    data: { template: template as Prisma.InputJsonValue },
  });
  return result.count > 0;
}

/** Sets or removes (null) where the partner is told about its customers' credit. */
export async function setPartnerWebhookUrl(
  prisma: PrismaClient,
  slug: string,
  url: string | null,
): Promise<Partner> {
  const result = await prisma.partner.updateMany({ where: { slug }, data: { webhookUrl: url } });
  if (result.count === 0) throw new Error(`Unknown partner: ${slug}`);
  return prisma.partner.findUniqueOrThrow({ where: { slug } });
}

/** Replaces the secret that signs the partner's webhook; the old one stops matching at once. */
export async function rotatePartnerWebhookSecret(
  prisma: PrismaClient,
  slug: string,
): Promise<Partner> {
  const result = await prisma.partner.updateMany({
    where: { slug },
    data: { webhookSecretVersion: { increment: 1 } },
  });
  if (result.count === 0) throw new Error(`Unknown partner: ${slug}`);
  return prisma.partner.findUniqueOrThrow({ where: { slug } });
}
