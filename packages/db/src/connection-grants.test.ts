import { describe, expect, it, vi } from "vitest";
import { grantConnectionAccess } from "./connection-grants.js";
import { IsolationError } from "./scope.js";

type Tx = Parameters<typeof grantConnectionAccess>[0];

function fakeTx(found: { mailbox?: boolean; mcp?: boolean; database?: boolean; bots?: number }) {
  const calls: string[] = [];
  const row = (present: boolean | undefined) => async () => (present ? { id: "c1" } : null);
  const tx = {
    bot: {
      findMany: async () => Array.from({ length: found.bots ?? 1 }, (_, i) => ({ id: `b${i}` })),
    },
    mailbox: { findFirst: row(found.mailbox) },
    mcpServer: { findFirst: row(found.mcp) },
    databaseConnection: { findFirst: row(found.database) },
    botMailbox: {
      createMany: vi.fn(async () => calls.push("mailbox.create")),
      updateMany: vi.fn(async () => calls.push("mailbox.update")),
    },
    botMcpServer: {
      createMany: vi.fn(async () => calls.push("mcp.create")),
      updateMany: vi.fn(async () => calls.push("mcp.update")),
    },
    botDatabaseGrant: { createMany: vi.fn(async () => calls.push("db.create")) },
  };
  return { tx: tx as unknown as Tx, calls, raw: tx };
}
const scope = { spaceId: "s", userId: "u" };

describe("grantConnectionAccess", () => {
  it("lends a mailbox at its level", async () => {
    const { tx, calls, raw } = fakeTx({ mailbox: true });
    await grantConnectionAccess(tx, scope, ["b0"], {
      kind: "mailbox",
      connectionId: "c1",
      level: "read",
    });
    expect(calls).toEqual(["mailbox.create", "mailbox.update"]);
    expect(raw.botMailbox.updateMany).toHaveBeenCalledWith({
      where: { mailboxId: "c1", botId: { in: ["b0"] } },
      data: { level: "read" },
    });
  });

  it("lends an MCP server with every tool at its level", async () => {
    const { tx, raw } = fakeTx({ mcp: true });
    await grantConnectionAccess(tx, scope, ["b0"], {
      kind: "mcp",
      connectionId: "c1",
      level: "write",
    });
    expect(raw.botMcpServer.updateMany).toHaveBeenCalledWith({
      where: { serverId: "c1", botId: { in: ["b0"] } },
      data: { allowAllTools: true, allowedTools: [], level: "write" },
    });
  });

  it("only reads a database", async () => {
    const { tx, calls } = fakeTx({ database: true });
    await grantConnectionAccess(tx, scope, ["b0"], {
      kind: "database",
      connectionId: "c1",
      level: "read",
    });
    expect(calls).toEqual(["db.create"]);
    await expect(
      grantConnectionAccess(tx, scope, ["b0"], {
        kind: "database",
        connectionId: "c1",
        level: "write",
      }),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("refuses a connection or an agent outside the owner's reach", async () => {
    await expect(
      grantConnectionAccess(fakeTx({}).tx, scope, ["b0"], {
        kind: "mailbox",
        connectionId: "c1",
        level: "read",
      }),
    ).rejects.toBeInstanceOf(IsolationError);
    await expect(
      grantConnectionAccess(fakeTx({ mcp: true, bots: 0 }).tx, scope, ["b0"], {
        kind: "mcp",
        connectionId: "c1",
        level: "read",
      }),
    ).rejects.toBeInstanceOf(IsolationError);
  });
});
