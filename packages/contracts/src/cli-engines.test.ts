import { describe, expect, it } from "vitest";
import { CliEngineStatusSchema, cliEngineModelId, parseCliEngineModelId } from "./cli-engines.js";

describe("CLI engine model ids", () => {
  it("parses and builds ids", () => {
    expect(parseCliEngineModelId("claude/sonnet")).toEqual({ engine: "claude", model: "sonnet" });
    expect(cliEngineModelId("claude", "opus")).toBe("claude/opus");
  });

  it.each(["codex/x", "claude/", "claude", "claude/a/b"])("rejects %s", (id) => {
    expect(parseCliEngineModelId(id)).toBeUndefined();
  });
});

describe("CliEngineStatusSchema", () => {
  const base = { id: "claude", state: "ready", version: "2.1.0", models: [], checkedAt: "now" };
  it("rejects an unknown state", () => {
    expect(CliEngineStatusSchema.safeParse({ ...base, state: "odd" }).success).toBe(false);
  });
  it("strips a path", () => {
    expect(CliEngineStatusSchema.parse({ ...base, path: "/bin/x" })).not.toHaveProperty("path");
  });
});
