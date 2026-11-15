import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrations = new URL("../prisma/migrations/", import.meta.url);
const sql = readFileSync(
  new URL("20261130000000_drop_previous_release_policies/migration.sql", migrations),
  "utf8",
);
const original = readFileSync(
  new URL("20261022120000_row_level_security_tenant_tables/migration.sql", migrations),
  "utf8",
);

describe("the previous-release policies migration", () => {
  it("only drops the compatibility policies and their version function", () => {
    const statements = sql.replace(/^--.*$/gm, "");
    expect(statements).not.toMatch(/\b(alter|create|insert|update|delete|truncate)\b/i);
    expect(statements).toContain("DROP POLICY IF EXISTS %I ON %I");
    expect(statements).toContain("protected || '_previous_release'");
    expect(statements).toContain("DROP FUNCTION IF EXISTS app_rls_version()");
  });

  it("covers every table that got a compatibility policy", () => {
    // The first list in each file is the one the compatibility policy is made for.
    const firstList = (text: string) =>
      new Set(
        [...text.matchAll(/ARRAY\[([^\]]+)\]/g)][0]![1]!
          .split(",")
          .map((name) => name.trim().replace(/'/g, "")),
      );
    expect(original).toContain("protected || '_previous_release'");
    expect(firstList(sql)).toEqual(firstList(original));
    expect(firstList(sql).size).toBe(21);
  });
});
