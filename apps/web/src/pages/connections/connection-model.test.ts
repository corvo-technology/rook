import type { ConnectionAccess, DatabaseConnection, McpServer } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  databaseItem,
  levelChoices,
  levelLabel,
  levelsFor,
  mcpItem,
  usedByNames,
} from "./connection-model";

const server = (patch: Partial<McpServer> = {}) =>
  ({
    id: "srv-1",
    name: "GitHub",
    slug: "github",
    transport: "streamable_http",
    endpoint: "https://api.example.test/mcp",
    command: null,
    oauthStatus: "connected",
    oauthClientId: null,
    health: { status: "ok", toolCount: 46, message: null, checkedAt: null },
    ...patch,
  }) as McpServer;

describe("usedByNames", () => {
  it("names the first three and counts the rest", () => {
    expect(usedByNames([], "en")).toBeNull();
    expect(usedByNames(["Chief"], "en")).toBe("Chief");
    expect(usedByNames(["Chief", "Engineer", "QA"], "en")).toBe("Chief, Engineer, and QA");
    expect(usedByNames(["A", "B", "C", "D", "E"], "en")).toBe("A, B, and C +2");
  });
});

describe("levels", () => {
  it("offers a database only none and read", () => {
    expect(levelChoices("database")).toEqual(["none", "read"]);
    expect(levelChoices("mcp")).toEqual(["none", "read", "write"]);
    expect(levelChoices("mailbox")).toEqual(["none", "read", "write"]);
  });

  it("labels a per-tool list from an older version as custom", () => {
    expect(levelLabel("custom")).toBe("Custom");
    expect(levelLabel("none")).toBe("No access");
  });

  it("reads one connection's levels out of the whole list", () => {
    const access: ConnectionAccess[] = [
      { kind: "mcp", connectionId: "srv-1", botId: "a", level: "write" },
      { kind: "mcp", connectionId: "srv-1", botId: "b", level: "custom" },
      { kind: "mcp", connectionId: "srv-2", botId: "a", level: "read" },
      { kind: "mailbox", connectionId: "srv-1", botId: "a", level: "read" },
    ];
    expect([...levelsFor(access, "mcp", "srv-1")]).toEqual([
      ["a", "write"],
      ["b", "custom"],
    ]);
  });
});

describe("connection rows", () => {
  it("shows a working server with its tool count", () => {
    expect(mcpItem(server())).toMatchObject({
      tone: "ok",
      status: "Connected · 46 tools",
      detail: "api.example.test",
    });
  });

  it("asks to reconnect before anything else", () => {
    expect(mcpItem(server({ oauthStatus: "reconnect" }))).toMatchObject({
      tone: "warn",
      status: "Needs reconnecting",
    });
  });

  it("marks a failing server and an unreachable database as errors", () => {
    expect(
      mcpItem(server({ health: { status: "error", toolCount: null } as McpServer["health"] })),
    ).toMatchObject({ tone: "error" });
    const database = {
      id: "db-1",
      name: "Sales",
      user: "reader",
      host: "db.example.test",
      database: "sales",
      testedOk: false,
    } as DatabaseConnection;
    expect(databaseItem(database)).toMatchObject({ tone: "error", status: "Not reachable" });
    expect(databaseItem({ ...database, testedOk: true })).toMatchObject({
      tone: "ok",
      status: "Read only",
    });
  });

  it("does not offer another member's server for access", () => {
    expect(mcpItem(server({ owner: { userId: "u2", name: "Ana", mine: false } })).otherOwner).toBe(
      "Ana",
    );
    expect(
      mcpItem(server({ owner: { userId: "u1", name: "Me", mine: true } })).otherOwner,
    ).toBeNull();
  });
});
