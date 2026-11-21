import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../prisma/migrations/20261222000000_research_jobs/migration.sql", import.meta.url),
  "utf8",
);

describe("the research jobs migration", () => {
  it("only adds tables, and puts both behind row-level security", () => {
    // The previous release runs beside this one for a few seconds after migrations apply.
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    for (const table of ["research_jobs", "research_sources"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${table}"`));
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY ${table}_tenant ON "${table}"`);
      expect(sql).toContain(`CREATE POLICY ${table}_system ON "${table}"`);
    }
  });
});
