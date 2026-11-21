import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROW_SECURITY_MODELS } from "./row-security.js";

const sql = readFileSync(
  new URL("../prisma/migrations/20261224000000_mcp_access_keys/migration.sql", import.meta.url),
  "utf8",
);

describe("the MCP access keys migration", () => {
  it("only adds a table, so the previous release keeps working beside it", () => {
    expect(sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "")).not.toMatch(
      /\b(insert|update|delete|drop|rename|alter table "(?!mcp_access_keys)\w+")\b/i,
    );
    expect(sql).toMatch(/CREATE TABLE "mcp_access_keys"/);
  });

  it("stores a digest of the key, never the key", () => {
    expect(sql).toContain('"secretHash" TEXT NOT NULL');
    expect(sql).not.toMatch(/"secret" /);
    expect(sql).toContain('CREATE UNIQUE INDEX "mcp_access_keys_secretHash_key"');
  });

  it("keeps a person's keys behind their own row-level security", () => {
    expect(sql).toContain('ALTER TABLE "mcp_access_keys" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY mcp_access_keys_tenant ON "mcp_access_keys"');
    expect(sql).toContain("\"userId\" = NULLIF(current_setting('app.user_id', true), '')");
    expect(sql).toContain('CREATE POLICY mcp_access_keys_system ON "mcp_access_keys"');
    expect(ROW_SECURITY_MODELS.has("McpAccessKey")).toBe(true);
  });
});
