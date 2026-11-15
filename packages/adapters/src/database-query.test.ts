import { describe, expect, it } from "vitest";
import type {
  DatabaseDriver,
  DatabaseRows,
  DatabaseSession,
  DatabaseTarget,
} from "./database-query.js";
import {
  DEFAULT_QUERY_LIMITS,
  describeDatabase,
  jsonCell,
  queryDatabase,
  redactDatabaseError,
} from "./database-query.js";

const target: DatabaseTarget = {
  id: "c1",
  host: "db.example.test",
  port: 5432,
  database: "app",
  user: "reader",
  password: "s3cret-pass",
  sslMode: "require",
};

/** A driver that records what it was asked and answers from a script. */
function fakeDriver(options: {
  rows?: DatabaseRows;
  failRead?: Error;
  failExec?: (sql: string) => Error | undefined;
}) {
  const log: string[] = [];
  const driver: DatabaseDriver = {
    async session(_target, run) {
      const session: DatabaseSession = {
        async exec(sql) {
          log.push(sql);
          const failure = options.failExec?.(sql);
          if (failure) throw failure;
        },
        async read(sql, limit, values) {
          log.push(`read:${sql}:${limit}:${JSON.stringify(values ?? null)}`);
          if (options.failRead) throw options.failRead;
          return options.rows ?? { columns: [], rows: [], more: false };
        },
      };
      return run(session);
    },
    async evict() {},
    async close() {},
  };
  return { driver, log };
}

describe("queryDatabase", () => {
  it("runs inside a read-only transaction with timeouts, and always rolls back", async () => {
    const { driver, log } = fakeDriver({ rows: { columns: ["n"], rows: [[1]], more: false } });
    const result = await queryDatabase(driver, target, "select 1;");
    expect(result).toMatchObject({ columns: ["n"], rows: [[1]], rowCount: 1, truncated: false });
    expect(log).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL statement_timeout = 15000",
      "SET LOCAL idle_in_transaction_session_timeout = 30000",
      "SET LOCAL default_transaction_read_only = on",
      `read:select 1:${DEFAULT_QUERY_LIMITS.maxRows + 1}:null`,
      "ROLLBACK",
    ]);
  });

  it("never reaches the database with a refused statement", async () => {
    const { driver, log } = fakeDriver({});
    const result = await queryDatabase(driver, target, "delete from users");
    expect(result).toMatchObject({ refused: true, error: expect.any(String) });
    expect(log).toEqual([]);
  });

  it("rolls back and reports a timeout, with the password redacted", async () => {
    const { driver, log } = fakeDriver({
      failRead: new Error("canceling statement due to statement timeout (s3cret-pass)"),
    });
    const result = await queryDatabase(driver, target, "select * from big");
    expect(result).toEqual({ error: "canceling statement due to statement timeout ([redacted])" });
    expect(log.at(-1)).toBe("ROLLBACK");
  });

  it("still reports the query error when the rollback itself fails", async () => {
    const { driver } = fakeDriver({
      failRead: new Error("relation does not exist"),
      failExec: (sql) => (sql === "ROLLBACK" ? new Error("connection lost") : undefined),
    });
    expect(await queryDatabase(driver, target, "select * from nope")).toEqual({
      error: "relation does not exist",
    });
  });

  it("caps rows and tells the model", async () => {
    const rows = Array.from({ length: DEFAULT_QUERY_LIMITS.maxRows + 1 }, (_, i) => [i]);
    const { driver } = fakeDriver({ rows: { columns: ["n"], rows, more: false } });
    const result = await queryDatabase(driver, target, "select n from t");
    expect(result).toMatchObject({ rowCount: DEFAULT_QUERY_LIMITS.maxRows, truncated: true });
    expect((result as { note: string }).note).toMatch(/more/);
  });

  it("caps result bytes and cell length", async () => {
    const wide = "x".repeat(2_000);
    const rows = Array.from({ length: 100 }, () => [wide, wide]);
    const { driver } = fakeDriver({ rows: { columns: ["a", "b"], rows, more: false } });
    const result = await queryDatabase(driver, target, "select a, b from t");
    if ("error" in result) throw new Error(result.error);
    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBeLessThan(100);
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(
      DEFAULT_QUERY_LIMITS.maxBytes + 2_000,
    );
    expect(String(result.rows[0]?.[0]).length).toBeLessThan(wide.length);
    expect(result.note).toMatch(/fewer columns/);
  });

  it("returns at least one row even when it alone exceeds the byte cap", async () => {
    const huge = "y".repeat(100_000);
    const { driver } = fakeDriver({ rows: { columns: ["a"], rows: [[huge]], more: false } });
    const result = await queryDatabase(driver, target, "select a from t");
    expect(result).toMatchObject({ rowCount: 1 });
  });
});

describe("describeDatabase", () => {
  it("groups columns by table and passes filters as parameters, not text", async () => {
    const { driver, log } = fakeDriver({
      rows: {
        columns: [],
        rows: [
          ["public", "orders", "id", "integer"],
          ["public", "orders", "total", "numeric"],
        ],
        more: false,
      },
    });
    const result = await describeDatabase(driver, target, { schema: "public'; drop table x; --" });
    expect(result).toEqual({
      tables: [{ table: "public.orders", columns: ["id integer", "total numeric"] }],
      truncated: false,
    });
    const read = log.find((line) => line.startsWith("read:")) ?? "";
    expect(read.split(":3001:")[0]).not.toContain("drop table");
    expect(read).toContain(`["public'; drop table x; --",null]`);
    expect(log[0]).toBe("BEGIN READ ONLY");
    expect(log.at(-1)).toBe("ROLLBACK");
  });
});

describe("jsonCell and redaction", () => {
  it("makes driver values safe to show", () => {
    expect(jsonCell(10n, 50)).toBe("10");
    expect(jsonCell(new Date("2026-01-02T03:04:05Z"), 50)).toBe("2026-01-02T03:04:05.000Z");
    expect(jsonCell(Buffer.from("abc"), 50)).toBe("<binary 3 bytes>");
    expect(jsonCell({ a: 1 }, 50)).toBe('{"a":1}');
    expect(jsonCell(undefined, 50)).toBeNull();
    expect(jsonCell("z".repeat(60), 10)).toBe(`${"z".repeat(10)}… (60 chars)`);
  });

  it("removes passwords and connection strings from errors", () => {
    expect(
      redactDatabaseError(new Error("bad postgres://reader:hunter2pw@db.example.test/app"), [
        "other-pass",
      ]),
    ).not.toContain("hunter2pw");
    expect(redactDatabaseError(new Error("password other-pass failed"), ["other-pass"])).toBe(
      "password [redacted] failed",
    );
  });
});
