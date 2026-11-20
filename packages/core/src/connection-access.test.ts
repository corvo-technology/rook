import { describe, expect, it } from "vitest";
import {
  accessLevelsFor,
  mailboxToolOffered,
  mcpGrantLevel,
  mcpToolOffered,
  storedAccessLevel,
} from "./connection-access.js";

const grant = (level: string, extra: Record<string, unknown> = {}) => ({
  allowAllTools: true,
  allowedTools: [],
  level,
  ...extra,
});

describe("mcpToolOffered", () => {
  it("offers every tool at write, including ones added later", () => {
    expect(mcpToolOffered(grant("write"), { name: "delete_repo" })).toBe(true);
    expect(mcpToolOffered(grant("write"), { name: "brand_new_tool", readOnly: false })).toBe(true);
  });

  it("offers only reads at read, from the hint or the name", () => {
    expect(mcpToolOffered(grant("read"), { name: "lookup", readOnly: true })).toBe(true);
    expect(mcpToolOffered(grant("read"), { name: "list_issues" })).toBe(true);
    expect(mcpToolOffered(grant("read"), { name: "search_code" })).toBe(true);
    expect(mcpToolOffered(grant("read"), { name: "create_issue" })).toBe(false);
    expect(mcpToolOffered(grant("read"), { name: "send_message" })).toBe(false);
    expect(mcpToolOffered(grant("read"), { name: "delete_branch" })).toBe(false);
  });

  it("does not let a declared read override a write name, or a declared write pass as a read", () => {
    expect(mcpToolOffered(grant("read"), { name: "delete_all", readOnly: true })).toBe(false);
    expect(mcpToolOffered(grant("read"), { name: "get_thing", readOnly: false })).toBe(false);
  });

  it("keeps a tool that is neither declared nor named as a read out of read access", () => {
    expect(mcpToolOffered(grant("read"), { name: "profile_card" })).toBe(false);
  });

  it("offers a tool declared read-only at read access unless it is destructive", () => {
    expect(mcpToolOffered(grant("read"), { name: "profile_card", readOnly: true })).toBe(true);
    expect(
      mcpToolOffered(grant("read"), { name: "get_thing", readOnly: true, destructive: true }),
    ).toBe(false);
  });

  it("offers camelCase and fetch-style reads at read access", () => {
    expect(mcpToolOffered(grant("read"), { name: "listPets" })).toBe(true);
    expect(mcpToolOffered(grant("read"), { name: "GMAIL_FETCH_EMAILS" })).toBe(true);
  });

  it("lets an explicit tool list from an older version decide alone", () => {
    const custom = grant("write", { allowAllTools: false, allowedTools: ["create_issue"] });
    expect(mcpToolOffered(custom, { name: "create_issue" })).toBe(true);
    expect(mcpToolOffered(custom, { name: "list_issues" })).toBe(false);
    expect(mcpGrantLevel(custom)).toBe("custom");
  });

  it("treats a grant that predates levels as write", () => {
    expect(storedAccessLevel(undefined)).toBe("write");
    expect(mcpGrantLevel({ allowAllTools: true, level: null })).toBe("write");
    expect(storedAccessLevel("something else")).toBe("read");
  });
});

describe("mailboxToolOffered", () => {
  it("maps read to search and read, and write to draft and send as well", () => {
    for (const tool of ["search", "read"]) expect(mailboxToolOffered("read", tool)).toBe(true);
    for (const tool of ["draft", "send"]) {
      expect(mailboxToolOffered("read", tool)).toBe(false);
      expect(mailboxToolOffered("write", tool)).toBe(true);
    }
  });
});

describe("accessLevelsFor", () => {
  it("offers a database only none and read", () => {
    expect(accessLevelsFor("database")).toEqual(["none", "read"]);
    expect(accessLevelsFor("mcp")).toEqual(["none", "read", "write"]);
    expect(accessLevelsFor("mailbox")).toEqual(["none", "read", "write"]);
  });
});
