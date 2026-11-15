import type { CustomSpaceRole, SpaceMember } from "@corvo/contracts";

export type PeopleGroup =
  | { key: "owner"; kind: "owner"; members: SpaceMember[] }
  | { key: string; kind: "role"; title: string; members: SpaceMember[] }
  | { key: "everyone"; kind: "everyone"; title: string | null; members: SpaceMember[] };

/** A person's highest role in the space: "owner", the name of the top custom role they hold, or nothing. */
export function highestRole(
  member: Pick<SpaceMember, "role" | "roleIds">,
  roles: readonly CustomSpaceRole[],
): "owner" | CustomSpaceRole | undefined {
  if (member.role === "owner") return "owner";
  return roles
    .filter((role) => role.systemKey !== "everyone" && member.roleIds.includes(role.id))
    .sort((a, b) => a.position - b.position)[0];
}

/**
 * People of a channel grouped by their highest role: the owner first, then the roles in the order
 * the space ranks them, then everyone else. Without `visible`, the channel is open and shows the
 * whole space. Empty groups are left out.
 */
export function groupPeopleByRole(input: {
  members: readonly SpaceMember[];
  roles: readonly CustomSpaceRole[];
  visible?: readonly string[] | null;
}): PeopleGroup[] {
  const allowed = input.visible ? new Set(input.visible) : null;
  const people = input.members
    .filter((member) => !allowed || allowed.has(member.userId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const ranked = input.roles
    .filter((role) => role.systemKey !== "everyone")
    .sort((a, b) => a.position - b.position);
  const everyone = input.roles.find((role) => role.systemKey === "everyone");
  const rankOf = new Map(ranked.map((role, index) => [role.id, index]));
  const highest = (member: SpaceMember) =>
    member.roleIds
      .flatMap((id) => (rankOf.has(id) ? [rankOf.get(id) as number] : []))
      .sort((a, b) => a - b)[0];
  const owners = people.filter((member) => member.role === "owner");
  const groups: PeopleGroup[] = [];
  if (owners.length) groups.push({ key: "owner", kind: "owner", members: owners });
  const rest = people.filter((member) => member.role !== "owner");
  ranked.forEach((role, index) => {
    const members = rest.filter((member) => highest(member) === index);
    if (members.length) groups.push({ key: role.id, kind: "role", title: role.name, members });
  });
  const base = rest.filter((member) => highest(member) === undefined);
  if (base.length) {
    groups.push({
      key: "everyone",
      kind: "everyone",
      title: everyone?.name ?? null,
      members: base,
    });
  }
  return groups;
}
