import { randomUUID } from "node:crypto";
import type { SpaceRole } from "@corvo/contracts";
import type { SpaceMembership, SpacePermission } from "@corvo/core";
import { can, personName, spaceRank, spaceRoleOf } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { assertSeatRoom, assertSeatRoomForAddresses, SeatLimitError } from "./seats.js";
import {
  getSpaceMembershipFor,
  loadSpaceRoles,
  resolveSpaceMemberships,
} from "./space-membership.js";
import { applyInvitedRoles, assertMayInvite, ensureDefaultSpaceRoles } from "./space-roles.js";
import { serializable, TeamError } from "./team-errors.js";

export type { TeamErrorCode } from "./team-errors.js";
export { TeamError } from "./team-errors.js";

export const INVITATION_DAYS = 7;
/** New invitations one space may send in a day, so a stolen admin session cannot spam. */
export const INVITATIONS_PER_SPACE_PER_DAY = 100;
/** How long a workspace link keeps working before someone has to make a new one. */
export const INVITE_LINK_DAYS = 30;
export const PENDING_JOIN_REQUESTS_PER_SPACE = 100;
export const PENDING_JOIN_REQUESTS_PER_USER = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

type Client = Pick<
  PrismaClient,
  | "spaceMember"
  | "member"
  | "space"
  | "spaceInvitation"
  | "spaceInviteLink"
  | "spaceJoinRequest"
  | "user"
  | "memoryDocument"
  | "notificationPreference"
  | "spaceRole"
  | "spaceMemberRole"
  | "billingAccount"
  | "organizationLimitOverride"
>;

async function roleIn(db: Client, spaceId: string, userId: string): Promise<string | null> {
  const row = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireKey(
  db: Client,
  spaceId: string,
  userId: string,
  key: SpacePermission,
): Promise<SpaceMembership> {
  const membership = await getSpaceMembershipFor(db, { spaceId, userId });
  if (!membership || !can(membership, key)) throw new TeamError("forbidden", "Not allowed");
  return membership;
}

/** Anyone who may bring people in may also answer the people who ask to join. */
async function requireInviter(
  db: Client,
  spaceId: string,
  userId: string,
): Promise<SpaceMembership> {
  const membership = await getSpaceMembershipFor(db, { spaceId, userId });
  if (!membership || !(can(membership, "invite_people") || can(membership, "manage_members")))
    throw new TeamError("forbidden", "Not allowed");
  return membership;
}

/** Where a person stands in the space's order of roles. */
async function rankIn(db: Client, spaceId: string, membership: SpaceMembership): Promise<number> {
  const roles = (await loadSpaceRoles(db, [spaceId])).get(spaceId) ?? [];
  return spaceRank(membership, new Map(roles.map((role) => [role.id, role.position])));
}

export async function listSpaceMembers(prisma: PrismaClient, spaceId: string) {
  const rows = await prisma.spaceMember.findMany({
    where: { spaceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      userId: true,
      role: true,
      createdAt: true,
      member: { select: { user: { select: { name: true, email: true } } } },
    },
  });
  const memberships = await resolveSpaceMemberships(
    prisma,
    rows.map((row) => ({ spaceId, userId: row.userId, role: row.role })),
  );
  return rows.map((row) => ({
    userId: row.userId,
    name: personName(row.member.user.name, row.member.user.email),
    email: row.member.user.email,
    role: spaceRoleOf(row.role),
    roleIds: [...(memberships.get(`${spaceId}:${row.userId}`)?.roleIds ?? [])],
    joinedAt: row.createdAt,
  }));
}

const ROLE_ORDER: Record<SpaceRole, number> = { member: 0, admin: 1, owner: 2 };

function isOwnerRole(stored: string): boolean {
  return spaceRoleOf(stored) === "owner";
}

async function ownerCount(db: Client, spaceId: string): Promise<number> {
  const rows = await db.spaceMember.findMany({ where: { spaceId }, select: { role: true } });
  return rows.filter((row) => isOwnerRole(row.role)).length;
}

export async function setMemberRole(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; userId: string; role: SpaceRole },
): Promise<void> {
  await serializable(prisma, async (tx) => {
    await ensureDefaultSpaceRoles(tx, input.spaceId);
    const actor = await requireKey(tx, input.spaceId, input.actorId, "manage_members");
    const targetRole = await roleIn(tx, input.spaceId, input.userId);
    if (!targetRole) throw new TeamError("not_found", "Not a member");
    const target = await getSpaceMembershipFor(tx, input);
    const rank = await rankIn(tx, input.spaceId, actor);
    const targetRank = target ? await rankIn(tx, input.spaceId, target) : Infinity;
    const next = input.role;
    // Ownership is not a role: only an owner gives it or takes it away.
    if (!actor.isOwner && (isOwnerRole(targetRole) || next === "owner"))
      throw new TeamError("forbidden", "Not allowed");
    // Anyone else changes only people at or below their own highest role.
    if (!actor.isOwner && targetRank < rank) throw new TeamError("forbidden", "Not allowed");
    if (!actor.isOwner && (next === "admin" || spaceRoleOf(targetRole) === "admin")) {
      // Giving or taking Admin takes holding it, with every key it carries.
      const admin = (await loadSpaceRoles(tx, [input.spaceId]))
        .get(input.spaceId)
        ?.find((role) => role.systemKey === "admin");
      if (
        !admin ||
        admin.position < rank ||
        !admin.keys.every((key) => can(actor, key as SpacePermission))
      )
        throw new TeamError("forbidden", "Not allowed");
    }
    if (isOwnerRole(targetRole) && next !== "owner" && (await ownerCount(tx, input.spaceId)) <= 1) {
      throw new TeamError("last_owner", "A workspace keeps at least one owner");
    }
    await tx.spaceMember.update({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
      data: { role: next },
    });
    const admin = await tx.spaceRole.findUnique({
      where: { spaceId_systemKey: { spaceId: input.spaceId, systemKey: "admin" } },
      select: { id: true },
    });
    if (admin && next === "admin") {
      await tx.spaceMemberRole.createMany({
        data: [{ spaceId: input.spaceId, userId: input.userId, roleId: admin.id }],
        skipDuplicates: true,
      });
    } else if (admin && next === "member") {
      await tx.spaceMemberRole.deleteMany({
        where: { spaceId: input.spaceId, userId: input.userId, roleId: admin.id },
      });
    }
  });
}

/**
 * Removes a member, or lets someone leave. Access ends with the row: every request reads the
 * membership, and streams re-check it. What the person made stays; their private conversations
 * stay theirs because the reads are scoped to the person.
 */
export async function removeMember(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; userId: string },
): Promise<{ organizationId: string }> {
  return serializable(prisma, async (tx) => {
    const actor = await getSpaceMembershipFor(tx, {
      spaceId: input.spaceId,
      userId: input.actorId,
    });
    if (!actor) throw new TeamError("forbidden", "Not allowed");
    const target = await tx.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
      select: { role: true, organizationId: true, member: { select: { id: true } } },
    });
    if (!target) throw new TeamError("not_found", "Not a member");
    if (input.userId !== input.actorId) {
      if (!can(actor, "manage_members")) throw new TeamError("forbidden", "Not allowed");
      const targetMembership = await getSpaceMembershipFor(tx, input);
      const rank = await rankIn(tx, input.spaceId, actor);
      const targetRank = targetMembership
        ? await rankIn(tx, input.spaceId, targetMembership)
        : Infinity;
      // Only an owner removes an owner; anyone else, people at or below their own highest role.
      if (!actor.isOwner && (isOwnerRole(target.role) || targetRank < rank))
        throw new TeamError("forbidden", "Not allowed");
    }
    if (isOwnerRole(target.role) && (await ownerCount(tx, input.spaceId)) <= 1)
      throw new TeamError("last_owner", "A workspace keeps at least one owner");
    await tx.spaceMember.delete({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    });
    // Someone with no space left in the organization no longer takes a seat in it.
    const remaining = await tx.spaceMember.count({
      where: { organizationId: target.organizationId, userId: input.userId },
    });
    if (remaining === 0) await tx.member.delete({ where: { id: target.member.id } });
    // A removed person who asked to join again must ask again.
    await tx.spaceJoinRequest.deleteMany({
      where: { spaceId: input.spaceId, userId: input.userId },
    });
    return { organizationId: target.organizationId };
  });
}

/** Adds a person to a space with a role; no-op when they already belong. */
async function addMember(
  tx: Client,
  input: {
    spaceId: string;
    userId: string;
    role: SpaceRole;
    roleIds?: readonly string[];
    /** The person joins on an invitation that already holds their seat. */
    onInvitation?: boolean;
  },
): Promise<{ organizationId: string; added: boolean }> {
  const space = await tx.space.findUnique({
    where: { id: input.spaceId },
    select: { organizationId: true, deletingAt: true },
  });
  if (!space || space.deletingAt) throw new TeamError("closed", "This workspace is closed");
  const existing = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    select: { id: true },
  });
  if (existing) return { organizationId: space.organizationId, added: false };
  const createdAt = new Date();
  let member = await tx.member.findUnique({
    where: {
      organizationId_userId: { organizationId: space.organizationId, userId: input.userId },
    },
    select: { id: true },
  });
  if (!member) {
    await assertSeatRoom(tx, space.organizationId, 1, { converts: input.onInvitation });
    member = await tx.member.create({
      data: {
        id: randomUUID(),
        organizationId: space.organizationId,
        userId: input.userId,
        role: "member",
        createdAt,
      },
      select: { id: true },
    });
    // A database trigger gives every new organization member the default space; an invitation
    // opens only the space it names.
    await tx.spaceMember.deleteMany({
      where: { id: `default-space-member:${member.id}`, spaceId: { not: input.spaceId } },
    });
  }
  await tx.spaceMember.upsert({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    create: {
      id: randomUUID(),
      spaceId: input.spaceId,
      organizationId: space.organizationId,
      userId: input.userId,
      role: input.role,
      createdAt,
    },
    update: { role: input.role },
  });
  await applyInvitedRoles(tx, {
    spaceId: input.spaceId,
    userId: input.userId,
    role: input.role,
    roleIds: input.roleIds ?? [],
  });
  const hasMemory = await tx.memoryDocument.findFirst({
    where: { spaceId: input.spaceId, userId: input.userId, scope: "user", path: "MEMORY.md" },
    select: { id: true },
  });
  if (!hasMemory) {
    await tx.memoryDocument.create({
      data: {
        spaceId: input.spaceId,
        userId: input.userId,
        scope: "user",
        path: "MEMORY.md",
        content: "# Space memory\n\n",
      },
    });
  }
  await tx.notificationPreference.upsert({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    create: { spaceId: input.spaceId, userId: input.userId },
    update: {},
  });
  return { organizationId: space.organizationId, added: true };
}

export interface InvitationRow {
  id: string;
  email: string;
  role: SpaceRole;
  roleIds: string[];
  status: "pending" | "accepted";
  expiresAt: Date;
  createdAt: Date;
  acceptedByName: string | null;
}

function invitationRow(row: {
  id: string;
  email: string;
  role: string;
  roleIds: string[];
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedBy?: { name: string } | null;
}): InvitationRow {
  return {
    id: row.id,
    email: row.email,
    role: spaceRoleOf(row.role),
    roleIds: row.roleIds,
    status: row.status === "accepted" ? "accepted" : "pending",
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    acceptedByName: row.acceptedBy?.name ?? null,
  };
}

/** Pending invitations that still work. Someone who accepted is a member now and is listed there. */
export async function listInvitations(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<InvitationRow[]> {
  await requireKey(prisma, input.spaceId, input.actorId, "invite_people");
  const now = input.now ?? new Date();
  const rows = await prisma.spaceInvitation.findMany({
    where: { spaceId: input.spaceId, status: "pending", expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => invitationRow(row));
}

export async function createInvitations(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    actorId: string;
    role: SpaceRole;
    /** Custom roles the person gets on joining; the sender must be able to give each. */
    roleIds?: readonly string[];
    addresses: string[];
    now?: Date;
  },
): Promise<{ invitations: InvitationRow[]; alreadyMembers: string[] }> {
  const now = input.now ?? new Date();
  const roleIds = await serializable(prisma, (tx) =>
    assertMayInvite(tx, { ...input, roleIds: input.roleIds ?? [] }),
  );
  const addresses = [...new Set(input.addresses.map((address) => address.trim().toLowerCase()))];
  if (addresses.length === 0) throw new TeamError("invalid", "No address to invite");
  const recent = await prisma.spaceInvitation.count({
    where: { spaceId: input.spaceId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } },
  });
  if (recent + addresses.length > INVITATIONS_PER_SPACE_PER_DAY)
    throw new TeamError("limit", "Too many invitations today");
  const members = await prisma.spaceMember.findMany({
    where: {
      spaceId: input.spaceId,
      member: { user: { email: { in: addresses, mode: "insensitive" } } },
    },
    select: { member: { select: { user: { select: { email: true } } } } },
  });
  const alreadyMembers = members.map((row) => row.member.user.email.toLowerCase());
  const space = await prisma.space.findUnique({
    where: { id: input.spaceId },
    select: { organizationId: true },
  });
  if (space)
    await assertSeatRoomForAddresses(
      prisma,
      space.organizationId,
      addresses.filter((email) => !alreadyMembers.includes(email)),
    );
  const invitations: InvitationRow[] = [];
  for (const email of addresses) {
    if (alreadyMembers.includes(email)) continue;
    const expiresAt = new Date(now.getTime() + INVITATION_DAYS * DAY_MS);
    // An address invited twice keeps one invitation, so the link already sent still works. The
    // second invitation never takes anything away: the higher role stays, and the roles add up.
    const row = await serializable(prisma, async (tx) => {
      const pending = await tx.spaceInvitation.findFirst({
        where: { spaceId: input.spaceId, email, status: "pending" },
        orderBy: { createdAt: "asc" },
      });
      if (!pending)
        return tx.spaceInvitation.create({
          data: {
            id: randomUUID(),
            spaceId: input.spaceId,
            email,
            role: input.role,
            roleIds,
            expiresAt,
            inviterId: input.actorId,
          },
        });
      const kept = ROLE_ORDER[spaceRoleOf(pending.role)] >= ROLE_ORDER[input.role];
      return tx.spaceInvitation.update({
        where: { id: pending.id },
        data: {
          role: kept ? pending.role : input.role,
          roleIds: [...new Set([...pending.roleIds, ...roleIds])],
          expiresAt,
        },
      });
    });
    invitations.push(invitationRow(row));
  }
  return { invitations, alreadyMembers };
}

export async function resendInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; id: string; now?: Date },
): Promise<InvitationRow> {
  const row = await prisma.spaceInvitation.findFirst({
    where: { id: input.id, spaceId: input.spaceId, status: "pending" },
  });
  if (!row) throw new TeamError("not_found", "No such invitation");
  await serializable(prisma, (tx) =>
    assertMayInvite(tx, {
      spaceId: input.spaceId,
      actorId: input.actorId,
      role: spaceRoleOf(row.role),
      roleIds: row.roleIds,
    }),
  );
  // An invitation that ran out holds no seat; sending it again takes one.
  const space = await prisma.space.findUnique({
    where: { id: input.spaceId },
    select: { organizationId: true },
  });
  if (space) await assertSeatRoomForAddresses(prisma, space.organizationId, [row.email]);
  const now = input.now ?? new Date();
  return invitationRow(
    await prisma.spaceInvitation.update({
      where: { id: row.id },
      data: { expiresAt: new Date(now.getTime() + INVITATION_DAYS * DAY_MS) },
    }),
  );
}

export async function cancelInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; id: string },
): Promise<void> {
  const row = await prisma.spaceInvitation.findFirst({
    where: { id: input.id, spaceId: input.spaceId, status: "pending" },
  });
  if (!row) throw new TeamError("not_found", "No such invitation");
  await serializable(prisma, (tx) =>
    assertMayInvite(tx, {
      spaceId: input.spaceId,
      actorId: input.actorId,
      role: spaceRoleOf(row.role),
      roleIds: row.roleIds,
    }),
  );
  await prisma.spaceInvitation.update({ where: { id: row.id }, data: { status: "cancelled" } });
}

export type InvitationPreview =
  | {
      state: "pending";
      spaceName: string;
      inviterName: string;
      email: string;
      role: SpaceRole;
      /** Names of the custom roles it gives, besides the base role. */
      roleNames: string[];
      /** Whether the address already has an account, so the page says sign in or make one. */
      hasAccount: boolean;
    }
  | { state: "accepted" }
  | { state: "expired"; inviterName: string };

/**
 * What the holder of an invitation link may see: what they get, and what became of a dead one. A
 * cancelled invitation reads like one that never existed.
 */
export async function previewInvitation(
  prisma: PrismaClient,
  id: string,
  now = new Date(),
): Promise<InvitationPreview | null> {
  const row = await prisma.spaceInvitation.findUnique({
    where: { id },
    include: { space: { select: { name: true } }, inviter: { select: { name: true } } },
  });
  if (!row || row.status === "cancelled") return null;
  if (row.status === "accepted") return { state: "accepted" };
  if (row.expiresAt <= now) return { state: "expired", inviterName: row.inviter.name };
  const [roles, account] = await Promise.all([
    prisma.spaceRole.findMany({
      where: { spaceId: row.spaceId, id: { in: row.roleIds } },
      orderBy: { position: "asc" },
      select: { name: true },
    }),
    prisma.user.count({ where: { email: { equals: row.email, mode: "insensitive" } } }),
  ]);
  return {
    state: "pending",
    spaceName: row.space.name,
    inviterName: row.inviter.name,
    email: row.email,
    role: spaceRoleOf(row.role),
    roleNames: roles.map((role) => role.name),
    hasAccount: account > 0,
  };
}

export interface InvitedUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Accepts one invitation for the signed-in person. The address must be theirs, and proven: a
 * confirmed account, or `mailProof` (the emailed link's own proof, checked by the caller).
 * `trustUnverified` is for deployments that cannot send mail and so cannot confirm anyone; there
 * the link itself, handed over by the inviter, is the proof. Otherwise an account made with
 * someone else's address could join their space. `"unverified"` says only that the address still
 * needs confirming; it is returned just to the account that holds the invited address.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: {
    id: string;
    user: InvitedUser;
    trustUnverified?: boolean;
    mailProof?: boolean;
    now?: Date;
  },
): Promise<{ spaceId: string; organizationId: string } | "unverified" | null> {
  const now = input.now ?? new Date();
  return serializable(prisma, async (tx) => {
    const row = await tx.spaceInvitation.findUnique({ where: { id: input.id } });
    if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
    if (!sameAddress(row.email, input.user.email)) return null;
    if (!input.user.emailVerified && !input.trustUnverified && !input.mailProof)
      return "unverified";
    const { organizationId } = await addMember(tx, {
      spaceId: row.spaceId,
      userId: input.user.id,
      role: spaceRoleOf(row.role),
      roleIds: row.roleIds,
      onInvitation: true,
    });
    await tx.spaceInvitation.update({
      where: { id: row.id },
      data: { status: "accepted", acceptedById: input.user.id, acceptedAt: now },
    });
    return { spaceId: row.spaceId, organizationId };
  });
}

/** True while an unexpired invitation waits for this address; signup policy lets it register. */
export async function hasPendingInvitation(
  prisma: PrismaClient,
  email: string,
  now = new Date(),
): Promise<boolean> {
  const count = await prisma.spaceInvitation.count({
    where: { email: email.trim().toLowerCase(), status: "pending", expiresAt: { gt: now } },
  });
  return count > 0;
}

/**
 * Signing in with an invited address joins the invited space(s), but only for a confirmed address:
 * anyone can sign up with an address that is not theirs. Returns what was joined; none means the
 * caller should provision a personal space as before.
 */
export async function acceptInvitationsForUser(
  prisma: PrismaClient,
  user: InvitedUser,
  options: { trustUnverified?: boolean; now?: Date } = {},
): Promise<Array<{ spaceId: string; organizationId: string }>> {
  const now = options.now ?? new Date();
  const rows = await prisma.spaceInvitation.findMany({
    where: { email: user.email.trim().toLowerCase(), status: "pending", expiresAt: { gt: now } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const joined: Array<{ spaceId: string; organizationId: string }> = [];
  for (const { id } of rows) {
    // A plan with no seat left leaves the invitation waiting; signing in still works.
    const result = await acceptInvitation(prisma, { id, user, ...options }).catch((error) => {
      if (error instanceof SeatLimitError) return null;
      throw error;
    });
    if (result && result !== "unverified") joined.push(result);
  }
  return joined;
}

const linkExpiry = (link: { createdAt: Date; expiresAt: Date | null }): Date =>
  link.expiresAt ?? new Date(link.createdAt.getTime() + INVITE_LINK_DAYS * DAY_MS);

/** The link people use to ask to join, while it works. Turning it off or letting it expire ends it. */
export async function activeInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<{ id: string } | null> {
  await requireKey(prisma, input.spaceId, input.actorId, "invite_people");
  const now = input.now ?? new Date();
  const link = await prisma.spaceInviteLink.findFirst({
    where: { spaceId: input.spaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });
  return link && linkExpiry(link) > now ? { id: link.id } : null;
}

export async function createInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<{ id: string }> {
  await requireKey(prisma, input.spaceId, input.actorId, "invite_people");
  const existing = await activeInviteLink(prisma, input);
  if (existing) return existing;
  const now = input.now ?? new Date();
  await prisma.spaceInviteLink.updateMany({
    where: { spaceId: input.spaceId, revokedAt: null },
    data: { revokedAt: now },
  });
  return prisma.spaceInviteLink.create({
    data: {
      id: randomUUID(),
      spaceId: input.spaceId,
      createdById: input.actorId,
      expiresAt: new Date(now.getTime() + INVITE_LINK_DAYS * DAY_MS),
    },
    select: { id: true },
  });
}

export async function disableInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<void> {
  await requireKey(prisma, input.spaceId, input.actorId, "invite_people");
  await prisma.spaceInviteLink.updateMany({
    where: { spaceId: input.spaceId, revokedAt: null },
    data: { revokedAt: input.now ?? new Date() },
  });
}

export type JoinOutcome = "requested" | "member";

/**
 * Someone with the workspace link asks to join. The answer is the same whether the link is on, off
 * or unknown, whether the person was denied before, and whether the space exists: only a current
 * member learns they already belong. Callers rate-limit by address before calling.
 */
export async function requestToJoin(
  prisma: PrismaClient,
  input: { linkId: string; userId: string; now?: Date },
): Promise<JoinOutcome> {
  const link = await prisma.spaceInviteLink.findUnique({ where: { id: input.linkId } });
  if (!link || link.revokedAt || linkExpiry(link) <= (input.now ?? new Date())) return "requested";
  const spaceId = link.spaceId;
  if (await roleIn(prisma, spaceId, input.userId)) return "member";
  const existing = await prisma.spaceJoinRequest.findUnique({
    where: { spaceId_userId: { spaceId, userId: input.userId } },
  });
  if (existing) return "requested";
  const [forSpace, forUser] = await Promise.all([
    prisma.spaceJoinRequest.count({ where: { spaceId, status: "pending" } }),
    prisma.spaceJoinRequest.count({ where: { userId: input.userId, status: "pending" } }),
  ]);
  if (forSpace >= PENDING_JOIN_REQUESTS_PER_SPACE || forUser >= PENDING_JOIN_REQUESTS_PER_USER)
    return "requested";
  await prisma.spaceJoinRequest
    .create({ data: { id: randomUUID(), spaceId, userId: input.userId } })
    .catch((error: unknown) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "P2002"))
        throw error;
    });
  return "requested";
}

export async function listJoinRequests(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string },
) {
  await requireInviter(prisma, input.spaceId, input.actorId);
  const rows = await prisma.spaceJoinRequest.findMany({
    where: { spaceId: input.spaceId, status: "pending" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.user.name,
    email: row.user.email,
    createdAt: row.createdAt,
  }));
}

/** Approving makes the person a member; denying keeps the row so asking again does nothing. */
export async function answerJoinRequest(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; id: string; approve: boolean; reason?: string },
): Promise<{ organizationId: string; added: boolean } | null> {
  return serializable(prisma, async (tx) => {
    await requireInviter(tx, input.spaceId, input.actorId);
    const request = await tx.spaceJoinRequest.findFirst({
      where: { id: input.id, spaceId: input.spaceId, status: "pending" },
    });
    if (!request) throw new TeamError("not_found", "No such request");
    const decided = {
      decidedById: input.actorId,
      decidedAt: new Date(),
    };
    if (!input.approve) {
      await tx.spaceJoinRequest.update({
        where: { id: request.id },
        data: { ...decided, status: "denied", reason: input.reason?.trim() || null },
      });
      return null;
    }
    const joined = await addMember(tx, {
      spaceId: input.spaceId,
      userId: request.userId,
      role: "member",
    });
    await tx.spaceJoinRequest.update({
      where: { id: request.id },
      data: { ...decided, status: "approved" },
    });
    return joined;
  });
}
