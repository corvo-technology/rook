import { describe, expect, it } from "vitest";
import {
  MCP_ACCESS_LEVELS,
  MCP_TOOL_LEVELS,
  McpAccessKeyCreateInputSchema,
  mcpLevelAllows,
} from "./mcp-access.js";

describe("MCP access levels", () => {
  it("each level includes the ones before it and no more", () => {
    expect(mcpLevelAllows("read", "read")).toBe(true);
    expect(mcpLevelAllows("read", "talk")).toBe(false);
    expect(mcpLevelAllows("read", "configure")).toBe(false);
    expect(mcpLevelAllows("talk", "read")).toBe(true);
    expect(mcpLevelAllows("talk", "talk")).toBe(true);
    expect(mcpLevelAllows("talk", "configure")).toBe(false);
    for (const level of MCP_ACCESS_LEVELS) expect(mcpLevelAllows("configure", level)).toBe(true);
  });

  it("gives every tool one of the three levels", () => {
    for (const level of Object.values(MCP_TOOL_LEVELS)) expect(MCP_ACCESS_LEVELS).toContain(level);
  });

  it("asks for a name and a known level when making a key", () => {
    expect(McpAccessKeyCreateInputSchema.safeParse({ name: "  ", level: "read" }).success).toBe(
      false,
    );
    expect(
      McpAccessKeyCreateInputSchema.safeParse({ name: "laptop", level: "admin" }).success,
    ).toBe(false);
    expect(
      McpAccessKeyCreateInputSchema.parse({ name: " laptop ", level: "talk", spaceId: "s1" }),
    ).toEqual({ name: "laptop", level: "talk", spaceId: "s1" });
  });
});
