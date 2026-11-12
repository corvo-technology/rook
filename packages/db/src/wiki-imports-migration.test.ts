import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../prisma/migrations/20261119000000_wiki_imports/migration.sql", import.meta.url),
  "utf8",
);

describe("the wiki imports migration", () => {
  it("only adds a table, and puts it behind row-level security", () => {
    // The previous release runs beside this one for a few seconds after migrations apply.
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    expect(sql).toMatch(/CREATE TABLE "wiki_imports"/);
    expect(sql).toContain('ALTER TABLE "wiki_imports" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY wiki_imports_tenant ON "wiki_imports"');
    expect(sql).toContain('CREATE POLICY wiki_imports_system ON "wiki_imports"');
  });
});
