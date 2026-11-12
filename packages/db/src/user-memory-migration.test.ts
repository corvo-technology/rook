import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../prisma/migrations/20261118000000_user_memory/migration.sql", import.meta.url),
  "utf8",
);

describe("the user memory migration", () => {
  it("only adds a table and columns, and copies no data", () => {
    // The previous release runs beside this one for a few seconds after migrations apply.
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename)\b/i,
    );
    expect(sql).toMatch(/CREATE TABLE "user_memories"/);
    expect(sql).toMatch(/ADD COLUMN\s+"memoryMode"/);
    expect(sql).toMatch(/ADD COLUMN\s+"memoryLearning"/);
    expect(sql).toMatch(/ADD COLUMN\s+"memoryLearnedUpToSeq"/);
  });

  it("keeps a person's memories behind their own row-level security", () => {
    expect(sql).toContain('ALTER TABLE "user_memories" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY user_memories_tenant ON "user_memories"');
    expect(sql).toContain("app.user_id");
    expect(sql).toContain('CREATE POLICY user_memories_system ON "user_memories"');
  });
});
