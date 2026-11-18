import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { livePartnerPricing } from "./partner-pricing.js";
import { configurePartnerCommerce, createPartner } from "./partners.js";
import { INVITATION_DAYS } from "./team.js";

/**
 * What the platform operators do with the people who asked in: decide a waitlist entry, and turn a
 * partner application into a partner. Everything runs as the system and is safe to repeat: a
 * decision is claimed with one conditional write, so a second approval changes and sends nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export class OnboardingError extends Error {
  constructor(readonly code: "not_found" | "invalid" | "conflict") {
    super(code);
    this.name = "OnboardingError";
  }
}

/** An invitation that was just made and still has to be mailed. */
export interface NewInvitation {
  id: string;
  email: string;
  /** The name of the workspace the person is invited into. */
  spaceName: string;
}

export const PLATFORM_PARTNER_MODES = ["embedded", "white_label", "referral"] as const;
export type PlatformPartnerMode = (typeof PLATFORM_PARTNER_MODES)[number];

/**
 * A new workspace for the person to own, and the invitation that opens it. The invitation is what
 * lets the address register where sign-up is closed or limited, and what puts the person in the
 * workspace instead of a personal one. Call inside a transaction.
 */
async function inviteToNewSpace(
  prisma: PrismaClient,
  input: { email: string; name: string; actorUserId: string; now: Date },
): Promise<NewInvitation & { organizationId: string }> {
  const organizationId = randomUUID();
  const invitationId = randomUUID();
  const name = input.name.trim() || "Company";
  {
    const tx = prisma;
    await tx.organization.create({
      data: {
        id: organizationId,
        name,
        slug: `invited-${randomBytes(8).toString("hex")}`,
        createdAt: input.now,
      },
    });
    await tx.space.create({
      data: {
        id: organizationId,
        organizationId,
        name,
        isDefault: true,
        createdByUserId: input.actorUserId,
        createdAt: input.now,
      },
    });
    await tx.spaceInvitation.create({
      data: {
        id: invitationId,
        spaceId: organizationId,
        email: input.email,
        role: "owner",
        expiresAt: new Date(input.now.getTime() + INVITATION_DAYS * DAY_MS),
        inviterId: input.actorUserId,
      },
    });
  }
  return { id: invitationId, email: input.email, spaceName: name, organizationId };
}

export function listWaitlist(prisma: PrismaClient) {
  return prisma.waitlistEntry.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      email: true,
      company: true,
      task: true,
      locale: true,
      status: true,
      createdAt: true,
    },
  });
}

/** Approving invites the address into a workspace of its own; deciding twice does nothing more. */
export async function decideWaitlistEntry(
  prisma: PrismaClient,
  input: { id: string; decision: "approved" | "declined"; actorUserId: string; now?: Date },
): Promise<{ invitation: NewInvitation | null }> {
  const now = input.now ?? new Date();
  const entry = await prisma.waitlistEntry.findUnique({ where: { id: input.id } });
  if (!entry) throw new OnboardingError("not_found");
  // One transaction: the decision and its invitation both happen or neither does.
  return prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;
    const claimed = await db.waitlistEntry.updateMany({
      where: { id: input.id, status: "pending" },
      data: { status: input.decision, decidedAt: now, decidedByUserId: input.actorUserId },
    });
    if (claimed.count === 0 || input.decision === "declined") return { invitation: null };
    const invitation = await inviteToNewSpace(db, {
      email: entry.email.trim().toLowerCase(),
      name: entry.company,
      actorUserId: input.actorUserId,
      now,
    });
    await db.waitlistEntry.update({
      where: { id: input.id },
      data: { invitationId: invitation.id },
    });
    return { invitation };
  });
}

export function listPartnerLeads(prisma: PrismaClient) {
  return prisma.partnerLead.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      company: true,
      email: true,
      whatsapp: true,
      website: true,
      partnerType: true,
      country: true,
      customers: true,
      message: true,
      status: true,
      createdAt: true,
    },
  });
}

export interface NewPartnerInput {
  /** The product's name, shown to its customers. */
  name: string;
  slug: string;
  mode: PlatformPartnerMode;
  /** Two letters; Brazil bills in reais, everywhere else in dollars. */
  country: string;
  /** A tier of the published pricing; only embedded partners are on a plan. */
  planKey?: string | null;
  /** The person who will run the partner. */
  ownerEmail: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/**
 * Makes the partner and gives its owner the Central do parceiro: an owner who already has an
 * organization gets the partner added to it, anyone else is invited to a new one. Returns the
 * invitation to mail, if one was made.
 */
export function createPlatformPartner(
  prisma: PrismaClient,
  input: NewPartnerInput & { actorUserId: string; now?: Date },
): Promise<{ partnerId: string; organizationId: string; invitation: NewInvitation | null }> {
  // One transaction: a failure midway leaves no partner, member, workspace or invitation behind.
  return prisma.$transaction((tx) => createPartnerIn(tx as unknown as PrismaClient, input));
}

async function createPartnerIn(
  prisma: PrismaClient,
  input: NewPartnerInput & { actorUserId: string; now?: Date },
): Promise<{ partnerId: string; organizationId: string; invitation: NewInvitation | null }> {
  const now = input.now ?? new Date();
  const email = input.ownerEmail.trim().toLowerCase();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const country = input.country.trim().toUpperCase();
  if (!name || !SLUG.test(slug) || !/^[A-Z]{2}$/.test(country))
    throw new OnboardingError("invalid");
  if (!(PLATFORM_PARTNER_MODES as readonly string[]).includes(input.mode)) {
    throw new OnboardingError("invalid");
  }
  let planKey: string | null = null;
  if (input.mode === "embedded" && input.planKey) {
    const live = await livePartnerPricing(prisma);
    if (!live?.config.tiers.some((tier) => tier.key === input.planKey)) {
      throw new OnboardingError("invalid");
    }
    planKey = input.planKey;
  }
  if (await prisma.partner.findUnique({ where: { slug }, select: { id: true } })) {
    throw new OnboardingError("conflict");
  }
  const existing = await prisma.member.findFirst({
    where: { role: "owner", user: { email: { equals: email, mode: "insensitive" } } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  const { partner } = await createPartner(prisma, { slug, name });
  await configurePartnerCommerce(prisma, slug, {
    mode: input.mode,
    country,
    billingModel: "commerce",
  });
  if (planKey) await prisma.partner.update({ where: { id: partner.id }, data: { planKey } });
  const invitation = existing
    ? null
    : await inviteToNewSpace(prisma, { email, name, actorUserId: input.actorUserId, now });
  const organizationId =
    existing?.organizationId ?? (invitation as { organizationId: string }).organizationId;
  await prisma.partnerMember.upsert({
    where: { partnerId_organizationId: { partnerId: partner.id, organizationId } },
    create: { partnerId: partner.id, organizationId },
    update: {},
  });
  // Ids and numbers only: no address or name of a person.
  await prisma.partnerAuditEvent.create({
    data: {
      partnerId: partner.id,
      actorUserId: input.actorUserId,
      kind: "partner.created",
      detail: { mode: input.mode, country, planKey, invited: Boolean(invitation) },
    },
  });
  return { partnerId: partner.id, organizationId, invitation };
}

/** Approving an application makes the partner once; the application remembers which. */
export async function approvePartnerLead(
  prisma: PrismaClient,
  input: {
    id: string;
    actorUserId: string;
    partner: Omit<NewPartnerInput, "ownerEmail">;
    now?: Date;
  },
): Promise<{ partnerId: string | null; invitation: NewInvitation | null }> {
  const now = input.now ?? new Date();
  const lead = await prisma.partnerLead.findUnique({ where: { id: input.id } });
  if (!lead) throw new OnboardingError("not_found");
  // One transaction: the claim, the partner, its owner's access and the invitation all happen or
  // none does, so a failure leaves the application pending and a retry works.
  return prisma.$transaction(async (tx) => {
    const db = tx as unknown as PrismaClient;
    const claimed = await db.partnerLead.updateMany({
      where: { id: input.id, status: "pending" },
      data: { status: "approved", decidedAt: now, decidedByUserId: input.actorUserId },
    });
    if (claimed.count === 0) return { partnerId: lead.partnerId, invitation: null };
    const created = await createPartnerIn(db, {
      ...input.partner,
      ownerEmail: lead.email,
      actorUserId: input.actorUserId,
      now,
    });
    await db.partnerLead.update({
      where: { id: input.id },
      data: { partnerId: created.partnerId },
    });
    return { partnerId: created.partnerId, invitation: created.invitation };
  });
}

export async function declinePartnerLead(
  prisma: PrismaClient,
  input: { id: string; actorUserId: string; reason?: string; now?: Date },
): Promise<void> {
  const lead = await prisma.partnerLead.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!lead) throw new OnboardingError("not_found");
  await prisma.partnerLead.updateMany({
    where: { id: input.id, status: "pending" },
    data: {
      status: "declined",
      decidedAt: input.now ?? new Date(),
      decidedByUserId: input.actorUserId,
      declineReason: input.reason?.trim() || null,
    },
  });
}
