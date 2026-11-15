import type { SpaceMembership } from "@corvo/core";
import {
  ADMIN_DEFAULT_KEYS,
  buildSpaceMembership,
  EVERYONE_DEFAULT_KEYS,
  spaceRoleOf,
} from "@corvo/core";
import type { PrismaClient } from "./client.js";

type Client = Pick<PrismaClient, "spaceRole" | "spaceMember">;

export interface StoredSpaceRole {
  id: string;
  name: string;
  color: string | null;
  position: number;
  keys: string[];
  systemKey: string | null;
}

/** What a space with no stored default roles yet holds, so every space reads the same way. */
const FALLBACK_EVERYONE: StoredSpaceRole = {
  id: "everyone",
  name: "Everyone",
  color: null,
  position: Number.MAX_SAFE_INTEGER,
  keys: [...EVERYONE_DEFAULT_KEYS],
  systemKey: "everyone",
};
const FALLBACK_ADMIN: StoredSpaceRole = {
  id: "admin",
  name: "Admin",
  color: null,
  position: 0,
  keys: [...ADMIN_DEFAULT_KEYS],
  systemKey: "admin",
};

/** The roles of the given spaces, the two default roles standing in where a space has none yet. */
export async function loadSpaceRoles(
  db: Client,
  spaceIds: readonly string[],
): Promise<Map<string, StoredSpaceRole[]>> {
  const rows = await db.spaceRole.findMany({
    where: { spaceId: { in: [...spaceIds] } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      spaceId: true,
      name: true,
      color: true,
      position: true,
      keys: true,
      systemKey: true,
    },
  });
  const bySpace = new Map<string, StoredSpaceRole[]>();
  for (const spaceId of spaceIds) bySpace.set(spaceId, []);
  for (const { spaceId, ...role } of rows) bySpace.get(spaceId)?.push(role);
  for (const roles of bySpace.values()) {
    if (!roles.some((role) => role.systemKey === "admin")) roles.unshift(FALLBACK_ADMIN);
    if (!roles.some((role) => role.systemKey === "everyone")) roles.push(FALLBACK_EVERYONE);
  }
  return bySpace;
}

/**
 * What each person may do in each space. `role` is `space_members.role`, which still says owner,
 * admin or member: a stored "admin" holds the space's Admin role even when no join row says so,
 * which is how an admin made by the previous release during a deploy keeps working.
 */
export async function resolveSpaceMemberships(
  db: Client,
  members: ReadonlyArray<{ spaceId: string; userId: string; role: string }>,
): Promise<Map<string, SpaceMembership>> {
  const spaceIds = [...new Set(members.map((member) => member.spaceId))];
  if (spaceIds.length === 0) return new Map();
  const [roles, joins] = await Promise.all([
    loadSpaceRoles(db, spaceIds),
    db.spaceMember.findMany({
      where: {
        spaceId: { in: spaceIds },
        userId: { in: [...new Set(members.map((member) => member.userId))] },
      },
      select: { spaceId: true, userId: true, roles: { select: { roleId: true } } },
    }),
  ]);
  const held = new Map(
    joins.map((join) => [
      `${join.spaceId}:${join.userId}`,
      new Set(join.roles.map((row) => row.roleId)),
    ]),
  );
  const result = new Map<string, SpaceMembership>();
  for (const member of members) {
    const stored = roles.get(member.spaceId) ?? [];
    const role = spaceRoleOf(member.role);
    const ids = held.get(`${member.spaceId}:${member.userId}`) ?? new Set<string>();
    const mine = stored.filter(
      (candidate) =>
        candidate.systemKey !== "everyone" &&
        (ids.has(candidate.id) || (role === "admin" && candidate.systemKey === "admin")),
    );
    result.set(
      `${member.spaceId}:${member.userId}`,
      buildSpaceMembership({
        isOwner: role === "owner",
        everyoneKeys: stored.find((candidate) => candidate.systemKey === "everyone")?.keys ?? [],
        held: mine,
      }),
    );
  }
  return result;
}

/** A person's standing in a space: the resolved keys, whether they own it, the roles they hold. */
export async function getSpaceMembershipFor(
  db: Client,
  input: { spaceId: string; userId: string },
): Promise<SpaceMembership | null> {
  const member = await db.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId: input.spaceId, userId: input.userId } },
    select: { role: true },
  });
  if (!member) return null;
  const resolved = await resolveSpaceMemberships(db, [{ ...input, role: member.role }]);
  return resolved.get(`${input.spaceId}:${input.userId}`) ?? null;
}
