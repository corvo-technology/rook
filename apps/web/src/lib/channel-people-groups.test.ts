import type { CustomSpaceRole, SpaceMember } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { groupPeopleByRole, highestRole } from "./channel-people-groups";

const role = (id: string, name: string, position: number, systemKey: "admin" | "everyone" | null) =>
  ({
    id,
    name,
    position,
    systemKey,
    color: null,
    keys: [],
    memberCount: 0,
  }) satisfies CustomSpaceRole;
const roles = [
  role("r-fin", "Finance", 1, null),
  role("r-admin", "Admin", 0, "admin"),
  role("r-all", "Everyone", 99, "everyone"),
];
const person = (userId: string, name: string, kind: SpaceMember["role"], roleIds: string[] = []) =>
  ({
    userId,
    name,
    email: `${userId}@example.test`,
    role: kind,
    roleIds,
    joinedAt: "2026-11-01T00:00:00.000Z",
  }) satisfies SpaceMember;
const members = [
  person("u-marta", "Marta", "member"),
  person("u-joao", "Joao", "member", ["r-fin"]),
  person("u-pedro", "Pedro", "owner", ["r-fin"]),
  person("u-ana", "Ana", "admin", ["r-fin", "r-admin"]),
];

describe("groupPeopleByRole", () => {
  it("puts the owner first, then roles by rank, then everyone", () => {
    const groups = groupPeopleByRole({ members, roles });
    expect(groups.map((group) => [group.key, group.members.map((m) => m.name)])).toEqual([
      ["owner", ["Pedro"]],
      ["r-admin", ["Ana"]],
      ["r-fin", ["Joao"]],
      ["everyone", ["Marta"]],
    ]);
  });

  it("places someone under their highest role only", () => {
    const groups = groupPeopleByRole({ members, roles });
    expect(groups.flatMap((group) => group.members).filter((m) => m.name === "Ana")).toHaveLength(
      1,
    );
  });

  it("lists only the people of a private channel and drops empty groups", () => {
    const groups = groupPeopleByRole({ members, roles, visible: ["u-marta", "u-pedro"] });
    expect(groups.map((group) => group.key)).toEqual(["owner", "everyone"]);
  });

  it("shows the whole space for an open channel", () => {
    expect(
      groupPeopleByRole({ members, roles, visible: null }).flatMap((g) => g.members),
    ).toHaveLength(4);
  });
});

describe("highestRole", () => {
  const roles = [
    { id: "a", name: "Finance", position: 1, systemKey: null },
    { id: "b", name: "Sales", position: 0, systemKey: null },
    { id: "all", name: "Everyone", position: 99, systemKey: "everyone" },
  ] as never;
  it("names the owner, then the highest custom role, and never the base role", () => {
    expect(highestRole({ role: "owner", roleIds: [] }, roles)).toBe("owner");
    expect(highestRole({ role: "member", roleIds: ["a", "b"] }, roles)).toMatchObject({
      name: "Sales",
    });
    expect(highestRole({ role: "member", roleIds: ["all"] }, roles)).toBeUndefined();
  });
});
