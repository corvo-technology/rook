import { randomUUID } from "node:crypto";
import type { SpaceMembership, SpacePermission } from "@corvo/core";
import {
  ADMIN_DEFAULT_KEYS,
  ADMINISTRATOR,
  can,
  EVERYONE_DEFAULT_KEYS,
  holdsAll,
  isSpacePermission,
  MAX_SPACE_ROLES,
  outranks,
  SPACE_ROLE_NAME_MAX,
  spaceRank,
  spaceRoleOf,
} from "@corvo/core";
import type { Prisma, PrismaClient } from "./client.js";
import { getSpaceMembershipFor } from "./space-membership.js";
import { serializable, TeamError } from "./team-errors.js";

type Tx = Pick<Prisma.TransactionClient, "spaceRole" | "spaceMember" | "spaceMemberRole">;

export interface SpaceRoleRow {
  id: string;
  name: string;
  color: string | null;
  position: number;
  keys: SpacePermission[];
  /** "everyone" is the base role every member holds; "admin" is the one every space starts with. */
  systemKey: "everyone" | "admin" | null;
  memberCount: number;
}

const systemKeyOf = (value: string | null): SpaceRoleRow["systemKey"] =>
  value === "everyone" || value === "admin" ? value : null;

/** Gives a space its two default roles when it has none yet, and Admin to the admins it already had. */
export async function ensureDefaultSpaceRoles(db: Tx, spaceId: string): Promise<void> {
  const existing = await db.spaceRole.findMany({
    where: { spaceId, systemKey: { in: ["everyone", "admin"] } },
    select: { systemKey: true },
  });
  const has = new Set(existing.map((row) => row.systemKey));
  if (!has.has("everyone")) {
    await db.spaceRole.create({
      data: {
        id: randomUUID(),
        spaceId,
        name: "Everyone",
        position: 2147483647,
        keys: [...EVERYONE_DEFAULT_KEYS],
        systemKey: "everyone",
      },
    });
  }
  if (!has.has("admin")) {
    const admin = await db.spaceRole.create({
      data: {
        id: randomUUID(),
        spaceId,
        name: "Admin",
        position: 0,
        keys: [...ADMIN_DEFAULT_KEYS],
        systemKey: "admin",
      },
    });
    const admins = await db.spaceMember.findMany({
      where: { spaceId, role: "admin" },
      select: { userId: true },
    });
    if (admins.length)
      await db.spaceMemberRole.createMany({
        data: admins.map((member) => ({ spaceId, userId: member.userId, roleId: admin.id })),
        skipDuplicates: true,
      });
  }
}

async function storedRoles(db: Tx, spaceId: string) {
  return db.spaceRole.findMany({
    where: { spaceId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
}

export async function listSpaceRoles(
  db: Pick<PrismaClient, "spaceRole" | "spaceMember">,
  spaceId: string,
): Promise<SpaceRoleRow[]> {
  const [rows, members] = await Promise.all([
    db.spaceRole.findMany({
      where: { spaceId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { members: true } } },
    }),
    db.spaceMember.count({ where: { spaceId } }),
  ]);
  const mapped = rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    position: row.position,
    keys: row.keys.filter(isSpacePermission),
    systemKey: systemKeyOf(row.systemKey),
    memberCount: row.systemKey === "everyone" ? members : row._count.members,
  }));
  if (!mapped.some((row) => row.systemKey === "everyone"))
    mapped.push({
      id: "everyone",
      name: "Everyone",
      color: null,
      position: 2147483647,
      keys: [...EVERYONE_DEFAULT_KEYS],
      systemKey: "everyone",
      memberCount: members,
    });
  if (!mapped.some((row) => row.systemKey === "admin"))
    mapped.unshift({
      id: "admin",
      name: "Admin",
      color: null,
      position: 0,
      keys: [...ADMIN_DEFAULT_KEYS],
      systemKey: "admin",
      memberCount: 0,
    });
  return mapped;
}

interface Actor {
  membership: SpaceMembership;
  rank: number;
  roles: Awaited<ReturnType<typeof storedRoles>>;
}

/** The actor's standing, read after the default roles exist so every id is a stored row. */
async function actorIn(
  tx: Tx,
  spaceId: string,
  actorId: string,
  key: SpacePermission,
): Promise<Actor> {
  await ensureDefaultSpaceRoles(tx, spaceId);
  const membership = await getSpaceMembershipFor(tx, { spaceId, userId: actorId });
  if (!membership || !can(membership, key)) throw new TeamError("forbidden", "Not allowed");
  const roles = await storedRoles(tx, spaceId);
  const positions = new Map(roles.map((role) => [role.id, role.position]));
  return { membership, rank: spaceRank(membership, positions), roles };
}

/** May the actor give or take away this role? At or below their own highest role, and only keys they hold. */
function mayGive(actor: Actor, role: { position: number; keys: readonly string[] }): boolean {
  if (actor.membership.isOwner) return true;
  return role.position >= actor.rank && holdsAll(actor.membership, role.keys);
}

function cleanKeys(keys: readonly string[]): SpacePermission[] {
  const unique = [...new Set(keys)];
  if (!unique.every(isSpacePermission)) throw new TeamError("invalid", "Unknown permission");
  return unique as SpacePermission[];
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > SPACE_ROLE_NAME_MAX) throw new TeamError("invalid", "Name");
  return trimmed;
}

export async function createSpaceRole(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    actorId: string;
    name: string;
    keys: readonly string[];
    color?: string | null;
  },
): Promise<string> {
  const name = cleanName(input.name);
  const keys = cleanKeys(input.keys);
  return serializable(prisma, async (tx) => {
    const actor = await actorIn(tx, input.spaceId, input.actorId, "manage_roles");
    if (!actor.membership.isOwner && !holdsAll(actor.membership, keys))
      throw new TeamError("forbidden", "Not allowed");
    if (actor.roles.length >= MAX_SPACE_ROLES) throw new TeamError("limit", "Too many roles");
    const last = Math.max(
      0,
      ...actor.roles.filter((role) => role.systemKey !== "everyone").map((role) => role.position),
    );
    const role = await tx.spaceRole.create({
      data: {
        id: randomUUID(),
        spaceId: input.spaceId,
        name,
        color: input.color ?? null,
        position: last + 1,
        keys,
      },
    });
    return role.id;
  });
}

export async function updateSpaceRole(
  prisma: PrismaClient,
  input: {
    spaceId: string;
    actorId: string;
    id: string;
    name?: string;
    keys?: readonly string[];
    color?: string | null;
  },
): Promise<void> {
  const name = input.name === undefined ? undefined : cleanName(input.name);
  const keys = input.keys === undefined ? undefined : cleanKeys(input.keys);
  await serializable(prisma, async (tx) => {
    const actor = await actorIn(tx, input.spaceId, input.actorId, "manage_roles");
    const role = actor.roles.find((candidate) => candidate.id === input.id);
    if (!role) throw new TeamError("not_found", "No such role");
    const everyone = role.systemKey === "everyone";
    // Everyone is the base role: below every other, so whoever manages roles may change it.
    if (!everyone && !outranks(actor.rank, role.position) && !actor.membership.isOwner)
      throw new TeamError("forbidden", "Not allowed");
    if (everyone && keys?.includes(ADMINISTRATOR))
      throw new TeamError("invalid", "Everyone cannot administer");
    if (keys && !actor.membership.isOwner) {
      const before = new Set(role.keys);
      const after = new Set<string>(keys);
      const changed = [...before, ...after].filter((key) => before.has(key) !== after.has(key));
      if (!holdsAll(actor.membership, changed)) throw new TeamError("forbidden", "Not allowed");
    }
    await tx.spaceRole.update({
      where: { id: role.id },
      data: {
        ...(name !== undefined && !everyone ? { name } : {}),
        ...(keys ? { keys } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
      },
    });
  });
}

export async function deleteSpaceRole(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; id: string },
): Promise<void> {
  await serializable(prisma, async (tx) => {
    const actor = await actorIn(tx, input.spaceId, input.actorId, "manage_roles");
    const role = actor.roles.find((candidate) => candidate.id === input.id);
    if (!role) throw new TeamError("not_found", "No such role");
    if (role.systemKey) throw new TeamError("invalid", "A default role stays");
    if (!actor.membership.isOwner && !outranks(actor.rank, role.position))
      throw new TeamError("forbidden", "Not allowed");
    await tx.spaceRole.delete({ where: { id: role.id } });
  });
}

/**
 * Puts the roles in the given order, highest first. `ids` names every role but Everyone. Anyone
 * but an owner leaves the roles at or above their own where they are.
 */
export async function reorderSpaceRoles(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; ids: readonly string[] },
): Promise<void> {
  await serializable(prisma, async (tx) => {
    const actor = await actorIn(tx, input.spaceId, input.actorId, "manage_roles");
    const ordered = actor.roles.filter((role) => role.systemKey !== "everyone");
    const sameSet =
      input.ids.length === ordered.length &&
      new Set(input.ids).size === ordered.length &&
      ordered.every((role) => input.ids.includes(role.id));
    if (!sameSet) throw new TeamError("invalid", "Every role once");
    if (!actor.membership.isOwner) {
      const frozen = ordered.filter((role) => !outranks(actor.rank, role.position));
      if (frozen.some((role, index) => input.ids[index] !== role.id))
        throw new TeamError("forbidden", "Not allowed");
    }
    for (const [position, id] of input.ids.entries())
      await tx.spaceRole.update({ where: { id }, data: { position } });
  });
}

/** `space_members.role` keeps saying owner, admin or member for the previous release. */
async function syncLegacyRole(tx: Tx, spaceId: string, userId: string): Promise<void> {
  const member = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
    select: { role: true, roles: { select: { role: { select: { systemKey: true } } } } },
  });
  if (!member || spaceRoleOf(member.role) === "owner") return;
  const admin = member.roles.some((row) => row.role.systemKey === "admin");
  const next = admin ? "admin" : "member";
  if (member.role !== next)
    await tx.spaceMember.update({
      where: { spaceId_userId: { spaceId, userId } },
      data: { role: next },
    });
}

/** Sets the custom roles a person holds. Owners are not roles; they stay as they are. */
export async function setMemberRoles(
  prisma: PrismaClient,
  input: { spaceId: string; actorId: string; userId: string; roleIds: readonly string[] },
): Promise<void> {
  await serializable(prisma, async (tx) => {
    const actor = await actorIn(tx, input.spaceId, input.actorId, "manage_members");
    const targetMembership = await getSpaceMembershipFor(tx, {
      spaceId: input.spaceId,
      userId: input.userId,
    });
    if (!targetMembership) throw new TeamError("not_found", "Not a member");
    const positions = new Map(actor.roles.map((role) => [role.id, role.position]));
    if (!actor.membership.isOwner && spaceRank(targetMembership, positions) < actor.rank)
      throw new TeamError("forbidden", "Not allowed");
    const wanted = new Set(input.roleIds);
    const byId = new Map(actor.roles.map((role) => [role.id, role]));
    for (const id of wanted) {
      const role = byId.get(id);
      if (!role || role.systemKey === "everyone") throw new TeamError("invalid", "No such role");
    }
    const current = await tx.spaceMemberRole.findMany({
      where: { spaceId: input.spaceId, userId: input.userId },
      select: { roleId: true },
    });
    const had = new Set(current.map((row) => row.roleId));
    const added = [...wanted].filter((id) => !had.has(id));
    const removed = [...had].filter((id) => !wanted.has(id));
    for (const id of added)
      if (!mayGive(actor, byId.get(id)!)) throw new TeamError("forbidden", "Not allowed");
    for (const id of removed) {
      const role = byId.get(id);
      if (role && !actor.membership.isOwner && role.position < actor.rank)
        throw new TeamError("forbidden", "Not allowed");
    }
    if (added.length)
      await tx.spaceMemberRole.createMany({
        data: added.map((roleId) => ({
          spaceId: input.spaceId,
          userId: input.userId,
          roleId,
        })),
        skipDuplicates: true,
      });
    if (removed.length)
      await tx.spaceMemberRole.deleteMany({
        where: { spaceId: input.spaceId, userId: input.userId, roleId: { in: removed } },
      });
    await syncLegacyRole(tx, input.spaceId, input.userId);
  });
}

/** What a sender may put on an invitation: the legacy role and the custom roles it carries. */
export async function assertMayInvite(
  tx: Tx,
  input: {
    spaceId: string;
    actorId: string;
    role: "owner" | "admin" | "member";
    roleIds: readonly string[];
  },
): Promise<string[]> {
  const actor = await actorIn(tx, input.spaceId, input.actorId, "invite_people");
  if (input.role === "owner" && !actor.membership.isOwner)
    throw new TeamError("forbidden", "Not allowed");
  const byId = new Map(actor.roles.map((role) => [role.id, role]));
  const ids = [...new Set(input.roleIds)];
  const wanted = ids.map((id) => byId.get(id));
  if (wanted.some((role) => !role || role.systemKey === "everyone"))
    throw new TeamError("invalid", "No such role");
  const given = [...wanted];
  if (input.role === "admin") given.push(actor.roles.find((role) => role.systemKey === "admin"));
  for (const role of given)
    if (!role || !mayGive(actor, role)) throw new TeamError("forbidden", "Not allowed");
  return ids;
}

/** Gives a new member the roles an invitation carried; roles deleted since are skipped. */
export async function applyInvitedRoles(
  tx: Tx,
  input: { spaceId: string; userId: string; role: string; roleIds: readonly string[] },
): Promise<void> {
  const admin = spaceRoleOf(input.role) === "admin";
  if (!admin && input.roleIds.length === 0) return;
  await ensureDefaultSpaceRoles(tx, input.spaceId);
  const found = await tx.spaceRole.findMany({
    where: {
      spaceId: input.spaceId,
      OR: [{ id: { in: [...input.roleIds] } }, ...(admin ? [{ systemKey: "admin" }] : [])],
    },
    select: { id: true, systemKey: true },
  });
  // Everyone is held by every member without a row; a null systemKey would fail a SQL NOT.
  const roles = found.filter((role) => role.systemKey !== "everyone");
  if (roles.length)
    await tx.spaceMemberRole.createMany({
      data: roles.map((role) => ({
        spaceId: input.spaceId,
        userId: input.userId,
        roleId: role.id,
      })),
      skipDuplicates: true,
    });
}

/** Who answers for an agent's approvals: its owner or anyone holding `approve_actions`. */
export async function mayDecideApprovals(
  db: Pick<PrismaClient, "spaceRole" | "spaceMember">,
  input: { spaceId: string; userId: string; ownerIds: ReadonlyArray<string | null | undefined> },
): Promise<boolean> {
  if (input.ownerIds.includes(input.userId)) return true;
  return can(await getSpaceMembershipFor(db, input), "approve_actions");
}
