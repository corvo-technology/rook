import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/20261130000000_notifications_presence/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("the notifications and presence migration", () => {
  it("only adds a table and a nullable column, so the previous release keeps working beside it", () => {
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "").replace(/^GRANT .*$/gm, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    expect(sql).toContain('ALTER TABLE "space_members" ADD COLUMN "lastSeenAt" TIMESTAMP(3);');
    expect(sql).not.toMatch(/SET NOT NULL|ALTER COLUMN/);
  });

  it("puts the entries behind row-level security by space", () => {
    expect(sql).toContain('ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY notifications_tenant ON "notifications"');
    expect(sql).toContain('CREATE POLICY notifications_system ON "notifications"');
  });
});
