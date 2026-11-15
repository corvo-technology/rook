import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseDriver } from "./database-query.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  recordSecurityEvent: vi.fn(async (event) => {
    events.push(event);
  }),
}));

const { databaseTools } = await import("./run-tools-databases.js");

const PASSWORD = "pw-from-the-secret-store";

function setup(grants: Array<{ name: string; id: string; spaceId?: string }>) {
  const log: string[] = [];
  const driver: DatabaseDriver = {
    async session(target, run) {
      log.push(`session:${target.id}:${target.password}`);
      return run({
        async exec(sql) {
          log.push(sql);
        },
        async read(sql) {
          log.push(`read:${sql}`);
          return { columns: ["secret_looking"], rows: [["row-data-1"]], more: false };
        },
      });
    },
    async evict() {},
    async close() {},
  };
  const secrets: string[] = [];
  const botDatabaseGrant = {
    findMany: vi.fn(async ({ where }: { where: { botId: string; spaceId: string } }) =>
      grants
        .filter((grant) => where.botId === "bot1" && where.spaceId === (grant.spaceId ?? "space1"))
        .map((grant) => ({
          createdAt: new Date(),
          connection: {
            id: grant.id,
            name: grant.name,
            host: "db.example.test",
            port: 5432,
            database: "app",
            username: "reader",
            sslMode: "require",
            secretId: `secret-${grant.id}`,
          },
        })),
    ),
  };
  const ctx = {
    deps: {
      prisma: {
        botDatabaseGrant,
        secret: {
          findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            ciphertext: "ciphertext",
          })),
        },
      },
      secretStore: { load: vi.fn(async () => PASSWORD) },
      databaseDriver: driver,
    },
    bot: { id: "bot1" },
    run: { spaceId: "space1", userId: "user1" },
    runId: "run1",
    secrets,
    state: { reply: { pendingProgress: 0, redactor: { finish: () => 0 } } },
    context: { signal: new AbortController().signal },
  } as unknown as RunContext;
  return { ctx, log, secrets, botDatabaseGrant };
}

const call = (args: Record<string, unknown>) => ({ args }) as unknown as ToolCall;

beforeEach(() => {
  events.length = 0;
});

describe("database tools", () => {
  it("queries a connection granted to the agent and registers its password for redaction", async () => {
    const { ctx, log, secrets } = setup([{ name: "Sales", id: "c1" }]);
    const result = await databaseTools.query_database!(ctx, call({ sql: "select 1" }));
    expect(result).toMatchObject({ columns: ["secret_looking"], rows: [["row-data-1"]] });
    expect(log).toContain("BEGIN READ ONLY");
    expect(secrets).toContain(PASSWORD);
  });

  it("refuses a connection the agent was not granted, whatever its name", async () => {
    const { ctx, log } = setup([{ name: "Sales", id: "c1" }]);
    const result = await databaseTools.query_database!(
      ctx,
      call({ connection: "Payroll", sql: "select 1" }),
    );
    expect(result).toMatchObject({
      error: expect.stringContaining('No database connection named "Payroll"'),
    });
    expect(log).toEqual([]);
  });

  it("does not use a grant from another space", async () => {
    const { ctx, log } = setup([{ name: "Sales", id: "c1", spaceId: "other-space" }]);
    const result = await databaseTools.query_database!(ctx, call({ sql: "select 1" }));
    expect(result).toMatchObject({ error: "No database connection is available to you." });
    expect(log).toEqual([]);
  });

  it("asks for the connection when several are granted and none is named", async () => {
    const { ctx } = setup([
      { name: "Sales", id: "c1" },
      { name: "Support", id: "c2" },
    ]);
    const result = await databaseTools.query_database!(ctx, call({ sql: "select 1" }));
    expect(result).toMatchObject({ error: expect.stringContaining("Available: Sales, Support") });
  });

  it("refuses writes before any connection is opened", async () => {
    const { ctx, log } = setup([{ name: "Sales", id: "c1" }]);
    const result = await databaseTools.query_database!(ctx, call({ sql: "delete from orders" }));
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(log.filter((line) => line.startsWith("read:"))).toEqual([]);
    expect(events.at(-1)?.metadata).toMatchObject({ outcome: "refused" });
  });

  it("audits each query without result data, the statement or the password", async () => {
    const { ctx } = setup([{ name: "Sales", id: "c1" }]);
    await databaseTools.query_database!(ctx, call({ sql: "select name from customers" }));
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      type: "database.query",
      metadata: {
        connectionId: "c1",
        botId: "bot1",
        runId: "run1",
        tool: "query_database",
        outcome: "ok",
        rows: 1,
      },
    });
    expect(typeof event?.metadata?.durationMs).toBe("number");
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("row-data-1");
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain("customers");
  });
});

describe("tool selection", () => {
  const base = {
    graphicalToolsAllowed: false,
    groupId: null,
    trigger: "user",
    semanticMemoryEnabled: false,
    messagingChannelRun: false,
  };
  const names = (extra: Record<string, unknown>) =>
    selectBuiltinToolsForRun({ ...base, ...extra }).map((tool) => tool.name);

  it("offers the database tools only to an agent with a grant", () => {
    expect(names({})).not.toContain("query_database");
    expect(names({ databasesGranted: true })).toEqual(
      expect.arrayContaining(["query_database", "describe_database"]),
    );
  });

  it("lets the owner switch them off for one agent", () => {
    expect(
      names({ databasesGranted: true, disabledBuiltinTools: ["query_database"] }),
    ).not.toContain("query_database");
  });

  it("never offers them to a visitor", () => {
    expect(names({ databasesGranted: true, visitorRun: true })).not.toContain("query_database");
  });
});
