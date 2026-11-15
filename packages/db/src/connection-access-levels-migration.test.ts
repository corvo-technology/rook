import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/20261205000000_connection_access_levels/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("the connection access levels migration", () => {
  it("only adds columns, so the previous release keeps working beside it", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(insert|update|delete|drop|rename)\b/i);
    expect(statements).toMatch(/ALTER TABLE "bot_mcp_servers" ADD COLUMN "level"/);
    expect(statements).toMatch(/ALTER TABLE "bot_mailboxes" ADD COLUMN "level"/);
  });

  it("gives every existing and every old-release grant full access", () => {
    // A default of write is what keeps anyone who had access from losing it.
    expect(sql.match(/TEXT NOT NULL DEFAULT 'write'/g)).toHaveLength(2);
  });
});
