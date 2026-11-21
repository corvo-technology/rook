import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { newAgentModelAuto } from "./model-auto.js";

describe("newAgentModelAuto", () => {
  it("routes a new agent by default", () => {
    expect(newAgentModelAuto({ modelId: null })).toBe(true);
  });

  it("never overrides a model that was chosen or inherited", () => {
    expect(newAgentModelAuto({ modelId: "pinned" })).toBe(false);
    expect(newAgentModelAuto({ modelId: "pinned", requested: true })).toBe(false);
    expect(newAgentModelAuto({ modelId: "pinned", parentAuto: true })).toBe(false);
  });

  it("follows an explicit request or the parent agent", () => {
    expect(newAgentModelAuto({ modelId: null, requested: false })).toBe(false);
    expect(newAgentModelAuto({ modelId: null, requested: true })).toBe(true);
    expect(newAgentModelAuto({ modelId: null, parentAuto: false })).toBe(false);
    expect(newAgentModelAuto({ modelId: null, parentAuto: true })).toBe(true);
  });
});

describe("auto routing migration", () => {
  const sql = readFileSync(
    new URL(
      "../prisma/migrations/20261222100000_auto_routing_default/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const backfill = sql.slice(sql.indexOf("UPDATE"));

  it("only turns routing on, and only for agents with no pinned model", () => {
    expect(backfill).toContain('SET "modelAuto" = true');
    expect(backfill).toContain('"modelAuto" = false');
    expect(backfill).toContain('"modelProvider" IS NULL');
    expect(backfill).toContain('"modelId" IS NULL');
    expect(backfill).not.toMatch(/SET "modelAuto" = false/);
  });

  it("changes a default without dropping or renaming anything", () => {
    expect(sql).toContain('ALTER COLUMN "modelAuto" SET DEFAULT true');
    expect(sql).not.toMatch(/DROP|RENAME/i);
  });
});
