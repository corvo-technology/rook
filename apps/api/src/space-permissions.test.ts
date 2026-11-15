import type { Actor } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  can,
  getSpaceMembership,
  requireCreatorOrPermission,
  requireSpacePermission,
} from "./space-permissions.js";

const actor: Actor = {
  userId: "u-b",
  spaceId: "s-1",
  email: "b@example.test",
  isDeploymentOwner: false,
};

function db(role: string | null) {
  return {
    spaceMember: {
      findUnique: async () => (role ? { role } : null),
    },
  } as never;
}

describe("shared space permissions", () => {
  it("lets every member work with agents and files, and only managers change them", () => {
    for (const key of [
      "talk_to_agents",
      "create_agents",
      "create_channels",
      "edit_wiki",
      "upload_files",
    ] as const) {
      expect(can({ role: "member" }, key)).toBe(true);
    }
    for (const key of [
      "manage_agents",
      "manage_channels",
      "manage_routines",
      "approve_actions",
      "manage_connections",
    ] as const) {
      expect(can({ role: "member" }, key)).toBe(false);
      expect(can({ role: "admin" }, key)).toBe(true);
      expect(can({ role: "owner" }, key)).toBe(true);
    }
  });

  it("gives a stranger nothing", () => {
    expect(can(null, "talk_to_agents")).toBe(false);
  });

  it("refuses non-members and members without the key", async () => {
    await expect(requireSpacePermission(db(null), actor, "talk_to_agents")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      requireSpacePermission(db("member"), actor, "manage_agents"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireSpacePermission(db("member"), actor, "talk_to_agents")).resolves.toEqual({
      role: "member",
    });
    await expect(getSpaceMembership(db(null), actor)).resolves.toBeNull();
  });

  it("lets the creator change their own agent, and anyone holding the key change another's", async () => {
    await expect(
      requireCreatorOrPermission(db("member"), actor, "u-b", "manage_agents"),
    ).resolves.toBeUndefined();
    await expect(
      requireCreatorOrPermission(db("member"), actor, "u-a", "manage_agents"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      requireCreatorOrPermission(db("admin"), actor, "u-a", "manage_agents"),
    ).resolves.toBeUndefined();
    // A creator who left the space no longer changes anything.
    await expect(
      requireCreatorOrPermission(db(null), actor, "u-b", "manage_agents"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
