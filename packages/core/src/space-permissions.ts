/**
 * Roles that add up. A person holds any number of custom roles in a space and may do what any of
 * them allows; every member also holds the space's base role, "Todos" ("Everyone"). The owner is
 * not a role: owners may do everything. Every authorization about what a person may do in a space
 * is `can(membership, key)`; nothing compares role names.
 */

/** The keys, by area. The order is the order the roles screen shows. */
export const SPACE_PERMISSION_AREAS = {
  chat: ["post", "create_channels", "manage_channels"],
  agents: [
    "talk_to_agents",
    "assign_work",
    "manage_routines",
    "approve_actions",
    "create_agents",
    "manage_agents",
  ],
  tools: ["use_computers", "control_computers", "manage_connections", "manage_credentials"],
  knowledge: ["edit_wiki", "upload_files", "review_memory"],
  space: [
    "invite_people",
    "view_usage",
    "configure",
    "manage_members",
    "manage_roles",
    "manage_billing",
    "create_spaces",
    "manage_partner",
  ],
} as const;

export type SpacePermissionArea = keyof typeof SPACE_PERMISSION_AREAS;

/** Grants every key below. */
export const ADMINISTRATOR = "administrator" as const;

type AreaKey = (typeof SPACE_PERMISSION_AREAS)[SpacePermissionArea][number];

export type SpacePermission = AreaKey | typeof ADMINISTRATOR;

/** Every key a role can hold, without `administrator`. */
export const SPACE_PERMISSION_KEYS: readonly AreaKey[] =
  Object.values(SPACE_PERMISSION_AREAS).flat();

const KNOWN = new Set<string>([...SPACE_PERMISSION_KEYS, ADMINISTRATOR]);

export function isSpacePermission(value: string): value is SpacePermission {
  return KNOWN.has(value);
}

/** Stored keys may name something a later release dropped; readers skip what they do not know. */
export function knownSpacePermissions(keys: readonly string[]): SpacePermission[] {
  return [...new Set(keys.filter(isSpacePermission))];
}

/** What a member of a space may do. A missing membership may do nothing. */
export interface SpaceMembership {
  /** Owners may do everything, including what no role grants: ownership and deleting the space. */
  isOwner: boolean;
  /** The custom roles the person holds, highest first; "Todos" is implicit and not listed. */
  roleIds: readonly string[];
  /** Resolved keys: the person's roles' and Todos' together. */
  permissions: readonly SpacePermission[];
}

export function can(
  membership: Pick<SpaceMembership, "isOwner" | "permissions"> | null | undefined,
  key: SpacePermission,
): boolean {
  if (!membership) return false;
  if (membership.isOwner) return true;
  return membership.permissions.includes(ADMINISTRATOR) || membership.permissions.includes(key);
}

/** A role as the resolver reads it. `position` 0 is the highest. */
export interface SpaceRoleKeys {
  id: string;
  position: number;
  keys: readonly string[];
}

/** The union of the keys of Todos and every held role, `administrator` expanded. */
export function resolveSpacePermissions(
  everyoneKeys: readonly string[],
  held: readonly Pick<SpaceRoleKeys, "keys">[],
): SpacePermission[] {
  const keys = knownSpacePermissions([...everyoneKeys, ...held.flatMap((role) => role.keys)]);
  return keys.includes(ADMINISTRATOR) ? [ADMINISTRATOR, ...SPACE_PERMISSION_KEYS] : keys;
}

export function buildSpaceMembership(input: {
  isOwner: boolean;
  everyoneKeys: readonly string[];
  held: readonly SpaceRoleKeys[];
}): SpaceMembership {
  const held = [...input.held].sort((a, b) => a.position - b.position);
  return {
    isOwner: input.isOwner,
    roleIds: held.map((role) => role.id),
    permissions: resolveSpacePermissions(input.everyoneKeys, held),
  };
}

/** Where a person stands in the order: an owner above every role, "Todos" below them all. */
export function spaceRank(
  membership: SpaceMembership,
  positions: ReadonlyMap<string, number>,
): number {
  if (membership.isOwner) return Number.NEGATIVE_INFINITY;
  let rank = Number.POSITIVE_INFINITY;
  for (const id of membership.roleIds) rank = Math.min(rank, positions.get(id) ?? rank);
  return rank;
}

/**
 * May the actor change, give or remove a role at `position`? Owners may any; everyone else only
 * those strictly below their own highest role.
 */
export function outranks(actorRank: number, position: number): boolean {
  return actorRank < position;
}

/**
 * May the actor hand out these keys? Owners and administrators may any; everyone else only keys
 * they hold themselves.
 */
export function holdsAll(membership: SpaceMembership, keys: readonly string[]): boolean {
  return knownSpacePermissions(keys).every((key) => can(membership, key));
}

/** What the base role "Todos" starts with: what a member could do before roles. */
export const EVERYONE_DEFAULT_KEYS: readonly SpacePermission[] = [
  "post",
  "create_channels",
  "talk_to_agents",
  "assign_work",
  "create_agents",
  "edit_wiki",
  "upload_files",
  "use_computers",
];

/**
 * What the default "Admin" role starts with: what an admin could do before roles, with everything
 * new that is not about money or ownership. Billing stays the owner's, as it was.
 */
export const ADMIN_DEFAULT_KEYS: readonly SpacePermission[] = SPACE_PERMISSION_KEYS.filter(
  (key) => key !== "manage_billing" && key !== "create_spaces",
);

export const MAX_SPACE_ROLES = 50;
export const SPACE_ROLE_NAME_MAX = 40;
