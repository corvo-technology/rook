import { randomUUID } from "node:crypto";
import type { SpaceRole } from "@corvo/contracts";
import { can, canGrantRole, canManageRole, spaceRoleOf } from "@corvo/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { withTransactionRetry } from "./transaction-retry.js";

export const INVITATION_DAYS = 7;
/** New invitations one space may send in a day, so a stolen admin session cannot spam. */
export const INVITATIONS_PER_SPACE_PER_DAY = 100;
export const PENDING_JOIN_REQUESTS_PER_SPACE = 100;
export const PENDING_JOIN_REQUESTS_PER_USER = 10;
const RECENT_JOIN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TeamErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "limit"
  | "last_owner"
  | "closed";

/** A refusal the API shows as-is; nothing in it names a person who has no right to be named. */
export class TeamError extends Error {
  constructor(
    readonly code: TeamErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamError";
  }
}

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
>;

async function roleIn(db: Client, spaceId: string, userId: string): Promise<string | null> {
  const row = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireRole(
  db: Client,
  spaceId: string,
  userId: string,
  permission: Parameters<typeof can>[1],
): Promise<string> {
  const role = await roleIn(db, spaceId, userId);
  if (!role || !can({ role }, permission)) throw new TeamError("forbidden", "Not allowed");
  return role;
}

function serializable<T>(prisma: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>) {
  return withTransactionRetry(() =>
    prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
  );
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
  return rows.map((row) => ({
    userId: row.userId,
    name: row.member.user.name,
    email: row.member.user.email,
    role: spaceRoleOf(row.role),
    joinedAt: row.createdAt,
  }));
}

async function ownerCount(db: Client, spaceId: string): Promise<number> {
  const rows = await db.spaceMember.findMany({ where: { spaceId }, select: { role: true } });
  return rows.filter((row) => spaceRoleOf(row.role) === "owner").length;
}

export async function setMemberRole(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; userId: string; role: SpaceRole },
): Promise<void> {
  await serializable(prisma, async (tx) => {
    const actorRole = await requireRole(tx, input.spaceId, input.actorId, "manage_members");
    const targetRole = await roleIn(tx, input.spaceId, input.userId);
    if (!targetRole) throw new TeamError("not_found", "Not a member");
    if (!canManageRole(actorRole, targetRole) || !canGrantRole(actorRole, input.role))
      throw new TeamError("forbidden", "Not allowed");
    if (
      spaceRoleOf(targetRole) === "owner" &&
      input.role !== "owner" &&
      (await ownerCount(tx, input.spaceId)) <= 1
    ) {
      throw new TeamError("last_owner", "A workspace keeps at least one owner");
    }
    await tx.spaceMember.update({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
      data: { role: input.role },
    });
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
    const actorRole = await roleIn(tx, input.spaceId, input.actorId);
    if (!actorRole) throw new TeamError("forbidden", "Not allowed");
    const target = await tx.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
      select: { role: true, organizationId: true, member: { select: { id: true } } },
    });
    if (!target) throw new TeamError("not_found", "Not a member");
    if (input.userId !== input.actorId && !canManageRole(actorRole, target.role))
      throw new TeamError("forbidden", "Not allowed");
    if (spaceRoleOf(target.role) === "owner" && (await ownerCount(tx, input.spaceId)) <= 1)
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
  input: { spaceId: string; userId: string; role: SpaceRole },
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
  status: "pending" | "accepted";
  expiresAt: Date;
  createdAt: Date;
  acceptedByName: string | null;
}

function invitationRow(row: {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  acceptedBy?: { name: string } | null;
}): InvitationRow {
  return {
    id: row.id,
    email: row.email,
    role: spaceRoleOf(row.role),
    status: row.status === "accepted" ? "accepted" : "pending",
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    acceptedByName: row.acceptedBy?.name ?? null,
  };
}

/** Pending invitations that still work, and recent joins so the inviter sees who arrived. */
export async function listInvitations(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<InvitationRow[]> {
  await requireRole(prisma, input.spaceId, input.actorId, "invite");
  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - RECENT_JOIN_DAYS * DAY_MS);
  const rows = await prisma.spaceInvitation.findMany({
    where: {
      spaceId: input.spaceId,
      OR: [
        { status: "pending", expiresAt: { gt: now } },
        { status: "accepted", acceptedAt: { gt: since } },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
  const accepters = await prisma.user.findMany({
    where: { id: { in: rows.flatMap((row) => (row.acceptedById ? [row.acceptedById] : [])) } },
    select: { id: true, name: true },
  });
  const names = new Map(accepters.map((user) => [user.id, user.name]));
  return rows.map((row) =>
    invitationRow({
      ...row,
      acceptedBy: row.acceptedById ? { name: names.get(row.acceptedById) ?? "" } : null,
    }),
  );
}

export async function createInvitations(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    actorId: string;
    role: SpaceRole;
    addresses: string[];
    now?: Date;
  },
): Promise<{ invitations: InvitationRow[]; alreadyMembers: string[] }> {
  const now = input.now ?? new Date();
  const actorRole = await requireRole(prisma, input.spaceId, input.actorId, "invite");
  if (!canGrantRole(actorRole, input.role)) throw new TeamError("forbidden", "Not allowed");
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
  const invitations: InvitationRow[] = [];
  for (const email of addresses) {
    if (alreadyMembers.includes(email)) continue;
    const pending = await prisma.spaceInvitation.findFirst({
      where: { spaceId: input.spaceId, email, status: "pending" },
    });
    const expiresAt = new Date(now.getTime() + INVITATION_DAYS * DAY_MS);
    // An address invited twice keeps one invitation, so the link already sent still works.
    const row = pending
      ? await prisma.spaceInvitation.update({
          where: { id: pending.id },
          data: { role: input.role, expiresAt, inviterId: input.actorId },
        })
      : await prisma.spaceInvitation.create({
          data: {
            id: randomUUID(),
            spaceId: input.spaceId,
            email,
            role: input.role,
            expiresAt,
            inviterId: input.actorId,
          },
        });
    invitations.push(invitationRow(row));
  }
  return { invitations, alreadyMembers };
}

export async function resendInvitation(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; id: string; now?: Date },
): Promise<InvitationRow> {
  const actorRole = await requireRole(prisma, input.spaceId, input.actorId, "invite");
  const row = await prisma.spaceInvitation.findFirst({
    where: { id: input.id, spaceId: input.spaceId, status: "pending" },
  });
  if (!row) throw new TeamError("not_found", "No such invitation");
  if (!canGrantRole(actorRole, spaceRoleOf(row.role)))
    throw new TeamError("forbidden", "Not allowed");
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
  const actorRole = await requireRole(prisma, input.spaceId, input.actorId, "invite");
  const row = await prisma.spaceInvitation.findFirst({
    where: { id: input.id, spaceId: input.spaceId, status: "pending" },
  });
  if (!row) throw new TeamError("not_found", "No such invitation");
  if (!canGrantRole(actorRole, spaceRoleOf(row.role)))
    throw new TeamError("forbidden", "Not allowed");
  await prisma.spaceInvitation.update({ where: { id: row.id }, data: { status: "cancelled" } });
}

/** What an invited person may see with the link: the workspace name, the inviter, the address. */
export async function previewInvitation(
  prisma: PrismaClient,
  id: string,
  now = new Date(),
): Promise<{ spaceName: string; inviterName: string; email: string } | null> {
  const row = await prisma.spaceInvitation.findUnique({
    where: { id },
    include: { space: { select: { name: true } }, inviter: { select: { name: true } } },
  });
  if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
  return { spaceName: row.space.name, inviterName: row.inviter.name, email: row.email };
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
 * Accepts one invitation for the signed-in person. The address must be theirs and confirmed;
 * `trustUnverified` is for deployments that cannot send mail and so cannot confirm anyone.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: { id: string; user: InvitedUser; trustUnverified?: boolean; now?: Date },
): Promise<{ spaceId: string; organizationId: string } | null> {
  const now = input.now ?? new Date();
  return serializable(prisma, async (tx) => {
    const row = await tx.spaceInvitation.findUnique({ where: { id: input.id } });
    if (!row || row.status !== "pending" || row.expiresAt <= now) return null;
    if (!sameAddress(row.email, input.user.email)) return null;
    if (!input.user.emailVerified && !input.trustUnverified) return null;
    const { organizationId } = await addMember(tx, {
      spaceId: row.spaceId,
      userId: input.user.id,
      role: spaceRoleOf(row.role),
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
 * Signing in with an invited address joins the invited space(s). Returns what was joined; none
 * means the caller should provision a personal space as before.
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
    const result = await acceptInvitation(prisma, { id, user, ...options });
    if (result) joined.push(result);
  }
  return joined;
}

/** The link people use to ask to join. Turning it off ends it; a new one is a different link. */
export async function activeInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string },
): Promise<{ id: string } | null> {
  await requireRole(prisma, input.spaceId, input.actorId, "invite");
  return prisma.spaceInviteLink.findFirst({
    where: { spaceId: input.spaceId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

export async function createInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string },
): Promise<{ id: string }> {
  await requireRole(prisma, input.spaceId, input.actorId, "invite");
  const existing = await activeInviteLink(prisma, input);
  if (existing) return existing;
  return prisma.spaceInviteLink.create({
    data: { id: randomUUID(), spaceId: input.spaceId, createdById: input.actorId },
    select: { id: true },
  });
}

export async function disableInviteLink(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; now?: Date },
): Promise<void> {
  await requireRole(prisma, input.spaceId, input.actorId, "invite");
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
  input: { linkId: string; userId: string },
): Promise<JoinOutcome> {
  const link = await prisma.spaceInviteLink.findUnique({ where: { id: input.linkId } });
  if (!link || link.revokedAt) return "requested";
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
  await requireRole(prisma, input.spaceId, input.actorId, "manage_members");
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
    await requireRole(tx, input.spaceId, input.actorId, "manage_members");
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
