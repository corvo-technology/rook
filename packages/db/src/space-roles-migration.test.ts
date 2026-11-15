import { readFileSync } from "node:fs";
import { ADMIN_DEFAULT_KEYS, buildSpaceMembership, can, EVERYONE_DEFAULT_KEYS } from "@corvo/core";
import { describe, expect, it } from "vitest";
import { ROW_SECURITY_MODELS } from "./row-security.js";

const sql = readFileSync(
  new URL("../prisma/migrations/20261123000000_space_roles/migration.sql", import.meta.url),
  "utf8",
);

/** The key list the migration gives the default role with this system key. */
function migratedKeys(systemKey: "everyone" | "admin"): string[] {
  const insert = sql
    .split(/INSERT INTO "space_roles"/)
    .find((part) => part.includes(`'${systemKey}', CURRENT_TIMESTAMP`));
  const array = insert?.match(/ARRAY\[([^\]]*)\]/)?.[1] ?? "";
  return [...array.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] as string);
}

describe("the space roles migration", () => {
  it("only adds tables and a column, and gives the existing spaces their default roles", () => {
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(/\b(drop|rename)\b/i);
    expect(sql).not.toMatch(/UPDATE "space_members"|DELETE FROM "space_members"/);
    expect(sql).toContain('ALTER TABLE "space_invitations" ADD COLUMN "roleIds"');
  });

  it("puts both tables behind row-level security", () => {
    for (const [table, model] of [
      ["space_roles", "SpaceRole"],
      ["space_member_roles", "SpaceMemberRole"],
    ] as const) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant ON "${table}"`);
      expect(sql).toContain(`CREATE POLICY ${table}_system ON "${table}"`);
      expect(ROW_SECURITY_MODELS.has(model)).toBe(true);
    }
  });

  it("gives Everyone what a member could do and Admin what an admin could", () => {
    expect(migratedKeys("everyone")).toEqual([...EVERYONE_DEFAULT_KEYS]);
    expect(migratedKeys("admin")).toEqual([...ADMIN_DEFAULT_KEYS]);
    const member = buildSpaceMembership({
      isOwner: false,
      everyoneKeys: migratedKeys("everyone"),
      held: [],
    });
    const admin = buildSpaceMembership({
      isOwner: false,
      everyoneKeys: migratedKeys("everyone"),
      held: [{ id: "admin", position: 0, keys: migratedKeys("admin") }],
    });
    // The old table: members none of these, admins these four, owners everything (billing too).
    for (const key of ["invite_people", "manage_members", "manage_agents", "configure"] as const) {
      expect(can(member, key)).toBe(false);
      expect(can(admin, key)).toBe(true);
    }
    expect(can(admin, "manage_billing")).toBe(false);
  });

  it("moves the admins to Admin and leaves space_members.role as it was", () => {
    expect(sql).toMatch(/INSERT INTO "space_member_roles"[\s\S]*WHERE m\."role" = 'admin'/);
  });
});
