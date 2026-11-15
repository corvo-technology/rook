import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/20261123000000_shared_space_content/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("the shared space content migration", () => {
  it("only adds a nullable column and a table, so the previous release keeps working beside it", () => {
    // The previous release runs beside this one for a few seconds after migrations apply.
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "").replace(/^GRANT .*$/gm, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    expect(sql).toContain('ALTER TABLE "messages" ADD COLUMN "authorUserId" TEXT;');
    expect(sql).not.toMatch(/"authorUserId" TEXT NOT NULL/);
    expect(sql).not.toMatch(/ALTER COLUMN|SET NOT NULL/);
  });

  it("puts the per-member read state behind row-level security by space", () => {
    expect(sql).toContain('ALTER TABLE "thread_member_reads" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY thread_member_reads_tenant ON "thread_member_reads"');
    expect(sql).toContain('CREATE POLICY thread_member_reads_system ON "thread_member_reads"');
  });
});
