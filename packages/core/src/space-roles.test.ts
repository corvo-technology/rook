import { describe, expect, it } from "vitest";
import { spaceRoleOf } from "./space-roles.js";

describe("space roles", () => {
  it("reads a legacy comma list by its highest role", () => {
    expect(spaceRoleOf("member, owner")).toBe("owner");
    expect(spaceRoleOf("admin")).toBe("admin");
    expect(spaceRoleOf("surprise")).toBe("member");
  });
});
