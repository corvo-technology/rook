import { PARTNER_SCOPES } from "@corvo/contracts";
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

export interface PartnerCommerceSettings {
  billingModel?: "wallet" | "commerce";
  mode?: "embedded" | "white_label";
  country?: string;
  commissionBps?: number;
  checkoutUrl?: string | null;
  scopes?: string[];
}

/**
 * What Rook decides about a partner's commerce: how it is billed, its country (which fixes the
 * currency), its commission and what its key may do. The currency can change only while the
 * partner has no subscription. Call with a client that runs as the system.
 */
export async function configurePartnerCommerce(
  prisma: PrismaClient,
  slug: string,
  input: PartnerCommerceSettings,
): Promise<Partner> {
  const partner = await prisma.partner.findUnique({ where: { slug } });
  if (!partner) throw new Error(`Unknown partner: ${slug}`);
  const data: Prisma.PartnerUpdateInput = {};
  if (input.billingModel) data.billingModel = input.billingModel;
  if (input.mode) data.mode = input.mode;
  if (input.commissionBps !== undefined) {
    if (
      !Number.isInteger(input.commissionBps) ||
      input.commissionBps < 0 ||
      input.commissionBps > 10_000
    ) {
      throw new Error("The commission is basis points from 0 to 10000");
    }
    data.commissionBps = input.commissionBps;
  }
  if (input.country !== undefined) {
    const country = input.country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new Error("The country is a two-letter code");
    const currency = country === "BR" ? "BRL" : "USD";
    if (currency !== partner.currency) {
      const active = await prisma.tenantSubscription.count({
        where: { tenant: { partnerId: partner.id } },
      });
      if (active > 0) throw new Error("The currency cannot change while customers have plans");
    }
    data.country = country;
    data.currency = currency;
  }
  if (input.checkoutUrl !== undefined) {
    if (input.checkoutUrl !== null && !isHttpsUrl(input.checkoutUrl)) {
      throw new Error("The checkout address must be https");
    }
    data.checkoutUrl = input.checkoutUrl;
  }
  if (input.scopes) {
    const unknown = input.scopes.filter(
      (scope) => !(PARTNER_SCOPES as readonly string[]).includes(scope),
    );
    if (unknown.length > 0) throw new Error(`Unknown scope: ${unknown.join(", ")}`);
    data.scopes = { set: [...new Set(input.scopes)] };
  }
  return prisma.partner.update({ where: { slug }, data });
}

function isHttpsUrl(value: string): boolean {
  try {
    return (
      new URL(value.replaceAll("{tenant}", "x").replaceAll("{pack}", "x")).protocol === "https:"
    );
  } catch {
    return false;
  }
}

/** The address "Comprar mais" opens: the partner's checkout with the customer and pack filled in. */
export function partnerCheckoutUrl(
  template: string | null,
  externalTenantId: string,
  pack?: string,
): string | null {
  if (!template || !isHttpsUrl(template)) return null;
  if (template.includes("{tenant}") || template.includes("{pack}")) {
    return template
      .replaceAll("{tenant}", encodeURIComponent(externalTenantId))
      .replaceAll("{pack}", encodeURIComponent(pack ?? ""));
  }
  const url = new URL(template);
  url.searchParams.set("tenant", externalTenantId);
  if (pack) url.searchParams.set("pack", pack);
  return url.toString();
}
