import { describe, expect, it } from "vitest";
import {
  ADMIN_DEFAULT_KEYS,
  buildSpaceMembership,
  can,
  EVERYONE_DEFAULT_KEYS,
  holdsAll,
  outranks,
  resolveSpacePermissions,
  SPACE_PERMISSION_KEYS,
  spaceRank,
} from "./space-permissions.js";

const nobody = { isOwner: false, roleIds: [], permissions: [] } as const;

describe("space permissions", () => {
  it("adds up the keys of Todos and every held role", () => {
    const membership = buildSpaceMembership({
      isOwner: false,
      everyoneKeys: ["post"],
      held: [
        { id: "a", position: 1, keys: ["view_usage"] },
        { id: "b", position: 0, keys: ["approve_actions"] },
      ],
    });
    expect(membership.roleIds).toEqual(["b", "a"]);
    expect(can(membership, "post")).toBe(true);
    expect(can(membership, "view_usage")).toBe(true);
    expect(can(membership, "approve_actions")).toBe(true);
    expect(can(membership, "manage_roles")).toBe(false);
  });

  it("lets administrator grant every key and skips keys it does not know", () => {
    const keys = resolveSpacePermissions([], [{ keys: ["administrator", "retired_key"] }]);
    for (const key of SPACE_PERMISSION_KEYS) expect(keys).toContain(key);
    expect(keys).not.toContain("retired_key");
  });

  it("lets owners do everything and a missing membership nothing", () => {
    expect(can({ isOwner: true, permissions: [] }, "manage_billing")).toBe(true);
    expect(can(null, "post")).toBe(false);
    expect(can(nobody, "post")).toBe(false);
  });

  it("orders people by their highest role, owners first and Todos last", () => {
    const positions = new Map([
      ["high", 0],
      ["low", 3],
    ]);
    const owner = { isOwner: true, roleIds: [], permissions: [] };
    const both = { isOwner: false, roleIds: ["low", "high"], permissions: [] };
    const low = { isOwner: false, roleIds: ["low"], permissions: [] };
    expect(spaceRank(owner, positions)).toBe(Number.NEGATIVE_INFINITY);
    expect(spaceRank(both, positions)).toBe(0);
    expect(spaceRank(nobody, positions)).toBe(Number.POSITIVE_INFINITY);
    expect(outranks(spaceRank(low, positions), 3)).toBe(false);
    expect(outranks(spaceRank(low, positions), 4)).toBe(true);
    expect(outranks(spaceRank(nobody, positions), 0)).toBe(false);
  });

  it("only grants keys one holds", () => {
    const membership = buildSpaceMembership({ isOwner: false, everyoneKeys: ["post"], held: [] });
    expect(holdsAll(membership, ["post"])).toBe(true);
    expect(holdsAll(membership, ["post", "edit_wiki"])).toBe(false);
    expect(holdsAll({ isOwner: true, roleIds: [], permissions: [] }, ["manage_billing"])).toBe(
      true,
    );
  });

  it("keeps what the three old roles could do", () => {
    const member = buildSpaceMembership({
      isOwner: false,
      everyoneKeys: EVERYONE_DEFAULT_KEYS,
      held: [],
    });
    const admin = buildSpaceMembership({
      isOwner: false,
      everyoneKeys: EVERYONE_DEFAULT_KEYS,
      held: [{ id: "admin", position: 0, keys: ADMIN_DEFAULT_KEYS }],
    });
    const owner = { isOwner: true, roleIds: [], permissions: [] };
    // The old table: member none, admin invite / manage_members / manage_agents / manage_settings.
    for (const key of ["invite_people", "manage_members", "manage_agents", "configure"] as const) {
      expect(can(member, key)).toBe(false);
      expect(can(admin, key)).toBe(true);
      expect(can(owner, key)).toBe(true);
    }
    expect(can(admin, "manage_billing")).toBe(false);
    expect(can(owner, "manage_billing")).toBe(true);
  });
});
