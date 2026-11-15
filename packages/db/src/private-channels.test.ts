import { describe, expect, it } from "vitest";
import type { GroupViewer } from "./channel-people.js";
import { channelVisibleTo, groupVisibleTo } from "./channel-people.js";

const viewer = (patch: Partial<GroupViewer> & { userId: string }): GroupViewer => ({
  roleIds: [],
  seesAll: false,
  ...patch,
});

describe("who sees a channel opened to people and roles", () => {
  const open = { userId: "creator", peopleIds: [], accessRoleIds: [] };
  const people = { userId: "creator", peopleIds: ["creator", "bia"], accessRoleIds: [] };
  const roles = { userId: "creator", peopleIds: [], accessRoleIds: ["sales"] };
  const both = { userId: "creator", peopleIds: ["creator", "bia"], accessRoleIds: ["sales"] };

  it("shows a channel with no people and no roles to everyone", () => {
    expect(groupVisibleTo(viewer({ userId: "ana" }), open)).toBe(true);
  });

  it("shows a private one to its creator, the people added, role holders and managers only", () => {
    for (const channel of [people, roles, both]) {
      expect(groupVisibleTo(viewer({ userId: "creator" }), channel)).toBe(true);
      expect(groupVisibleTo(viewer({ userId: "dani", seesAll: true }), channel)).toBe(true);
      expect(groupVisibleTo(viewer({ userId: "ana" }), channel)).toBe(false);
      expect(groupVisibleTo(viewer({ userId: "ana", roleIds: ["ops"] }), channel)).toBe(false);
    }
    expect(groupVisibleTo(viewer({ userId: "bia" }), people)).toBe(true);
    expect(groupVisibleTo(viewer({ userId: "bia" }), roles)).toBe(false);
    expect(groupVisibleTo(viewer({ userId: "caio", roleIds: ["ops", "sales"] }), roles)).toBe(true);
    expect(groupVisibleTo(viewer({ userId: "caio", roleIds: ["sales"] }), people)).toBe(false);
    expect(groupVisibleTo(viewer({ userId: "caio", roleIds: ["sales"] }), both)).toBe(true);
  });

  it("builds the same rule as a query filter", () => {
    expect(channelVisibleTo(viewer({ userId: "x", seesAll: true }))).toEqual({});
    expect(channelVisibleTo(viewer({ userId: "ana" }))).toEqual({
      OR: [
        { userId: "ana" },
        { people: { none: {} }, accessRoleIds: { isEmpty: true } },
        { people: { some: { userId: "ana" } } },
      ],
    });
    expect(channelVisibleTo(viewer({ userId: "caio", roleIds: ["sales"] }))).toEqual({
      OR: [
        { userId: "caio" },
        { people: { none: {} }, accessRoleIds: { isEmpty: true } },
        { people: { some: { userId: "caio" } } },
        { accessRoleIds: { hasSome: ["sales"] } },
      ],
    });
  });
});
