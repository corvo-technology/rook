import { describe, expect, it } from "vitest";
import { can, canGrantRole, canManageRole, spaceRoleOf } from "./space-roles.js";

describe("space roles", () => {
  it("gives owners everything and members nothing", () => {
    expect(can({ role: "owner" }, "manage_billing")).toBe(true);
    expect(can({ role: "member" }, "invite")).toBe(false);
    expect(can(null, "invite")).toBe(false);
  });

  it("lets admins run the team but not billing or the space", () => {
    expect(can({ role: "admin" }, "manage_members")).toBe(true);
    expect(can({ role: "admin" }, "manage_billing")).toBe(false);
    expect(can({ role: "admin" }, "delete_space")).toBe(false);
  });

  it("reads a legacy comma list by its highest role", () => {
    expect(spaceRoleOf("member, owner")).toBe("owner");
    expect(spaceRoleOf("surprise")).toBe("member");
  });

  it("keeps owners out of an admin's reach and never grants above one's own role", () => {
    expect(canManageRole("admin", "owner")).toBe(false);
    expect(canManageRole("admin", "member")).toBe(true);
    expect(canManageRole("owner", "owner")).toBe(true);
    expect(canGrantRole("admin", "owner")).toBe(false);
    expect(canGrantRole("admin", "admin")).toBe(true);
  });
});
