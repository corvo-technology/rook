import type { SpaceRole } from "@corvo/contracts";

/** The stored role string, which older rows may hold as a comma list; the highest role wins. */
export function spaceRoleOf(stored: string | null | undefined): SpaceRole {
  const roles = (stored ?? "").split(",").map((role) => role.trim());
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "admin";
  return "member";
}
