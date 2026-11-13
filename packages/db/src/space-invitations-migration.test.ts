import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../prisma/migrations/20261121000000_space_invitations/migration.sql", import.meta.url),
  "utf8",
);

describe("the space invitations migration", () => {
  it("only adds tables, so the previous release keeps working beside it", () => {
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    for (const table of ["space_invitations", "space_invite_links", "space_join_requests"]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant ON "${table}"`);
      expect(sql).toContain(`CREATE POLICY ${table}_system ON "${table}"`);
    }
  });

  it("limits a member's view to their own space", () => {
    expect(sql).toContain("app.space_id");
  });
});
