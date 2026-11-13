import type { SpaceRole } from "@corvo/contracts";

export type SpacePermission =
  | "invite"
  | "manage_members"
  | "manage_agents"
  | "manage_settings"
  | "manage_billing"
  | "manage_owners"
  | "delete_space";

const ALL: SpacePermission[] = [
  "invite",
  "manage_members",
  "manage_agents",
  "manage_settings",
  "manage_billing",
  "manage_owners",
  "delete_space",
];

/** One fixed table; every backend authorization for a person's role reads it. */
const PERMISSIONS: Record<SpaceRole, readonly SpacePermission[]> = {
  owner: ALL,
  admin: ["invite", "manage_members", "manage_agents", "manage_settings"],
  member: [],
};

const RANK: Record<SpaceRole, number> = { owner: 2, admin: 1, member: 0 };

/** The stored role string, which older rows may hold as a comma list; the highest role wins. */
export function spaceRoleOf(stored: string | null | undefined): SpaceRole {
  const roles = (stored ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}

/** Whether a membership may do something. A missing membership may do nothing. */
export function can(
  membership: { role: string | null | undefined } | null | undefined,
  permission: SpacePermission,
): boolean {
  if (!membership) return false;
  return PERMISSIONS[spaceRoleOf(membership.role)].includes(permission);
}

/** May `actor` change or remove someone holding `target`? Only owners manage owners. */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (!can({ role: actorRole }, "manage_members")) return false;
  return spaceRoleOf(targetRole) !== "owner" || can({ role: actorRole }, "manage_owners");
}

/** May `actor` grant `role`? Nobody grants a role above their own. */
export function canGrantRole(actorRole: string, role: SpaceRole): boolean {
  return RANK[spaceRoleOf(actorRole)] >= RANK[role];
}
