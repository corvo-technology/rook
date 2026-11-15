import { describe, expect, it } from "vitest";
import { requireCreatorOrPermission, requireSpacePermission } from "./space-owner.js";

const actor = { userId: "u-b", spaceId: "s-1" };

function db(role: string | null) {
  return {
    spaceMember: { findUnique: async () => (role ? { role, roles: [] } : null) },
    spaceRole: { findMany: async () => [] },
  } as never;
}

describe("permissions on shared content", () => {
  it("lets every member work with agents and files, and only managers change them", async () => {
    for (const key of [
      "talk_to_agents",
      "create_agents",
      "create_channels",
      "upload_files",
    ] as const) {
      await expect(requireSpacePermission(db("member"), actor, key)).resolves.toBeUndefined();
    }
    for (const key of [
      "manage_agents",
      "manage_channels",
      "manage_routines",
      "manage_connections",
    ] as const) {
      await expect(requireSpacePermission(db("member"), actor, key)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(requireSpacePermission(db("admin"), actor, key)).resolves.toBeUndefined();
      await expect(requireSpacePermission(db("owner"), actor, key)).resolves.toBeUndefined();
    }
    await expect(requireSpacePermission(db(null), actor, "talk_to_agents")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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
    await expect(
      requireCreatorOrPermission(db(null), actor, "u-b", "manage_agents"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
