import type { PartnerRoleDef, PartnerTemplate } from "@corvo/contracts";
import type { SpacePermission } from "./space-permissions.js";
import { knownSpacePermissions } from "./space-permissions.js";

/** What a person of a partner's customer gets, once their role is read against the template. */
export interface ResolvedPartnerRole {
  /** The role as the partner named it, lower case. */
  name: string;
  /** The customer's owner: everything, through the account the customer already has. */
  owner: boolean;
  /** Keys of the template agents this role talks to. */
  agents: string[];
  permissions: SpacePermission[];
  /** Areas of the embedded app the role does not see, on top of the template's own. */
  hide: string[];
}

/** The role of a session that names none: the customer's owner, as sessions were before roles. */
export const PARTNER_OWNER_ROLE = "owner";

/** What a customer's people hold in their space before any role adds to it: they may only talk. */
export const PARTNER_BASE_PERMISSIONS: readonly SpacePermission[] = ["talk_to_agents"];

/** Managers run the customer day to day; a template that says nothing about them gets this. */
const MANAGER_DEFAULT: PartnerRoleDef = {
  agents: ["*"],
  permissions: [
    "talk_to_agents",
    "assign_work",
    "approve_actions",
    "manage_routines",
    "view_usage",
  ],
};

/** Billing, settings and agent management are the owner's; a role gets agents back only with manage_agents. */
const NON_OWNER_HIDDEN = ["team", "billing", "settings"] as const;

export function normalizePartnerRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase() || PARTNER_OWNER_ROLE;
}

export function isPartnerOwnerRole(role: string | null | undefined): boolean {
  return normalizePartnerRole(role) === PARTNER_OWNER_ROLE;
}

/**
 * Reads a role against the template. A role the template does not define gets no agents, so a
 * name the partner invents (or mistypes) never opens more than it should.
 */
export function resolvePartnerRole(
  template: Pick<PartnerTemplate, "agents" | "roles"> | null | undefined,
  role: string | null | undefined,
): ResolvedPartnerRole {
  const name = normalizePartnerRole(role);
  const allKeys = (template?.agents ?? []).map((agent) => agent.key);
  if (name === PARTNER_OWNER_ROLE) {
    return { name, owner: true, agents: allKeys, permissions: [], hide: [] };
  }
  const defined = template?.roles?.[name] ?? (name === "manager" ? MANAGER_DEFAULT : undefined);
  const wanted = new Set(defined?.agents ?? []);
  const agents = wanted.has("*") ? allKeys : allKeys.filter((key) => wanted.has(key));
  const permissions = knownSpacePermissions([
    ...PARTNER_BASE_PERMISSIONS,
    ...(defined?.permissions ?? []),
  ]);
  const hide = new Set<string>([...NON_OWNER_HIDDEN, ...(defined?.hide ?? [])]);
  // A role that may manage agents sees where they are, unless the template says otherwise.
  if (permissions.includes("manage_agents") && !defined?.hide?.includes("team"))
    hide.delete("team");
  if (!permissions.includes("manage_routines")) hide.add("routines");
  return { name, owner: false, agents, permissions, hide: [...hide] };
}
