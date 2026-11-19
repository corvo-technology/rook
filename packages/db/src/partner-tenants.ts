import { createHash, randomBytes } from "node:crypto";
import { PartnerTemplate } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { commerceSettings } from "./commerce-config.js";
import { stateAllowsAccess, subscriptionState } from "./commerce-money.js";
import type { PartnerTenant } from "./generated/prisma/client.js";

export type PartnerTenantState = "enabled" | "suspended";

/** A customer id already belongs to the other mode: a test key never reaches a live customer. */
export class PartnerTenantModeMismatch extends Error {
  constructor() {
    super("tenant_mode");
    this.name = "PartnerTenantModeMismatch";
  }
}

export interface ProvisionedPartnerTenant {
  tenantId: string;
  organizationId: string;
  spaceId: string;
  ownerUserId: string;
  /** False when the customer already existed and nothing was created. */
  created: boolean;
}

/** How long a partner customer's session lasts from the moment it began, however it is renewed. */
export const PARTNER_SESSION_MS = 8 * 60 * 60_000;

const PARTNER_OWNER_EMAIL_SUFFIX = "@partner.invalid";

/** True once a partner customer's session has outlived its fixed lifetime; no one else's ever is. */
export function partnerSessionExpired(
  session: { email: string; createdAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    session.email.endsWith(PARTNER_OWNER_EMAIL_SUFFIX) &&
    now.getTime() - session.createdAt.getTime() >= PARTNER_SESSION_MS
  );
}

const newId = () => randomBytes(16).toString("hex");

/** Fixed per partner and customer, so the same request always names the same rows. */
function tenantDigest(partnerId: string, externalTenantId: string): string {
  return createHash("sha256").update(`${partnerId}\n${externalTenantId}`).digest("hex");
}

/**
 * Gives a partner's customer its own organization, space and owner, once. The customer's single
 * owner has an address nobody can write to, so it can never be confused with a real account. Calls
 * for the same customer queue behind each other, so two at once still make one. Call with a client
 * that runs as the system.
 */
export async function provisionPartnerTenant(
  prisma: PrismaClient,
  partner: { id: string; testMode?: boolean },
  input: { externalTenantId: string; name: string },
): Promise<ProvisionedPartnerTenant> {
  const testMode = partner.testMode === true;
  const digest = tenantDigest(partner.id, input.externalTenantId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`;
    const existing = await tx.partnerTenant.findUnique({
      where: {
        partnerId_externalTenantId: {
          partnerId: partner.id,
          externalTenantId: input.externalTenantId,
        },
      },
      include: { organization: { select: { id: true } } },
    });
    if (existing) {
      if (existing.testMode !== testMode) throw new PartnerTenantModeMismatch();
      // A customer made before it ran on credit gets the same footing as a new one.
      await tx.modelCreditAccount.updateMany({
        where: { organizationId: existing.organizationId, mode: null },
        data: { mode: "credits" },
      });
      return {
        tenantId: existing.id,
        organizationId: existing.organizationId,
        spaceId: existing.organizationId,
        ownerUserId: existing.ownerUserId,
        created: false,
      };
    }
    const now = new Date();
    const orgId = newId();
    const userId = newId();
    const name = input.name.trim() || "Company";
    await tx.user.create({
      data: {
        id: userId,
        name,
        email: `p-${digest.slice(0, 24)}${PARTNER_OWNER_EMAIL_SUFFIX}`,
        emailVerified: true,
      },
    });
    await tx.organization.create({
      data: { id: orgId, name, slug: `partner-${digest.slice(0, 24)}`, createdAt: now },
    });
    await tx.member.create({
      data: { id: newId(), organizationId: orgId, userId, role: "owner", createdAt: now },
    });
    await tx.space.create({
      data: {
        id: orgId,
        organizationId: orgId,
        name,
        isDefault: true,
        createdByUserId: userId,
        createdAt: now,
      },
    });
    await tx.spaceMember.create({
      data: {
        id: newId(),
        spaceId: orgId,
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: now,
      },
    });
    await tx.memoryDocument.create({
      data: {
        spaceId: orgId,
        userId,
        scope: "user",
        path: "MEMORY.md",
        content: "# Space memory\n\nPreferences and context kept within this space live here.\n",
      },
    });
    await tx.notificationPreference.create({ data: { spaceId: orgId, userId } });
    // A customer never sets up a model: it runs on the deployment's, paid from its credit.
    await tx.modelCreditAccount.create({ data: { organizationId: orgId, mode: "credits" } });
    const tenant = await tx.partnerTenant.create({
      data: {
        partnerId: partner.id,
        externalTenantId: input.externalTenantId,
        organizationId: orgId,
        ownerUserId: userId,
        testMode,
      },
    });
    return {
      tenantId: tenant.id,
      organizationId: orgId,
      spaceId: orgId,
      ownerUserId: userId,
      created: true,
    };
  });
}

/**
 * Only the partner that created a customer can find it; any other partner gets null. A key finds
 * the customers of its own mode only: the test key never sees a live customer, nor the live key a
 * test one.
 */
export async function findPartnerTenant(
  prisma: PrismaClient,
  partnerId: string,
  externalTenantId: string,
  testMode = false,
): Promise<PartnerTenant | null> {
  const tenant = await prisma.partnerTenant.findUnique({
    where: { partnerId_externalTenantId: { partnerId, externalTenantId } },
  });
  return tenant && tenant.testMode === testMode ? tenant : null;
}

/**
 * False when the partner has no such customer, so a caller can answer as for any unknown one.
 * Suspending also signs the customer out everywhere, so a frame that is already open stops at once.
 */
export async function setPartnerTenantState(
  prisma: PrismaClient,
  partnerId: string,
  externalTenantId: string,
  state: PartnerTenantState,
  testMode = false,
): Promise<boolean> {
  const result = await prisma.partnerTenant.updateMany({
    where: { partnerId, externalTenantId, testMode },
    data: { state },
  });
  if (result.count > 0 && state === "suspended") {
    const tenant = await findPartnerTenant(prisma, partnerId, externalTenantId, testMode);
    if (tenant) await prisma.session.deleteMany({ where: { userId: tenant.ownerUserId } });
  }
  return result.count > 0;
}

/**
 * The partner's state for the customer a space belongs to, or null for any other space. A commerce
 * customer without a usable plan (none reported, past its grace period, or canceled and ended) is
 * "inactive": runs are refused, and its data stays readable.
 */
export async function partnerSpaceState(
  prisma: PrismaClient,
  spaceId: string,
  now = new Date(),
): Promise<PartnerTenantState | "inactive" | null> {
  const tenant = await prisma.partnerTenant.findFirst({
    where: { organization: { spaces: { some: { id: spaceId } } } },
    select: {
      state: true,
      testMode: true,
      partner: { select: { billingModel: true } },
      subscription: { select: { status: true, periodEnd: true, pastDueSince: true } },
    },
  });
  if (!tenant) return null;
  if (tenant.state === "suspended") return "suspended";
  // A test customer has no plan to pay for, so a commerce partner can try it before selling one.
  if (tenant.testMode || tenant.partner.billingModel !== "commerce") return "enabled";
  const { graceDays } = await commerceSettings(prisma);
  return stateAllowsAccess(subscriptionState(tenant.subscription, now, graceDays))
    ? "enabled"
    : "inactive";
}

/**
 * Whether the customer a space belongs to may pick its own model: "fixed" (the default, so a
 * customer cannot raise the partner's cost) or "choose"; null for a space that is not a partner's.
 */
export async function partnerModelPolicy(
  prisma: PrismaClient,
  spaceId: string,
): Promise<"fixed" | "choose" | null> {
  const tenant = await prisma.partnerTenant.findFirst({
    where: { organization: { spaces: { some: { id: spaceId } } } },
    select: { partner: { select: { template: true } } },
  });
  if (!tenant) return null;
  return PartnerTemplate.safeParse(tenant.partner.template).data?.models === "choose"
    ? "choose"
    : "fixed";
}
