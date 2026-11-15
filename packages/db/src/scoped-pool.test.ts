import type { Pool, PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { runAsSystem, runAsTenant, scopeToDbContext } from "./row-security.js";

type Sent = { text: string; values?: unknown[] };

function fakePool(options: { failOn?: string } = {}) {
  const sent: Sent[] = [];
  let released = 0;
  const client = {
    async query(first: string | Sent, values?: unknown[]) {
      const text = typeof first === "string" ? first : first.text;
      sent.push({ text, values: values ?? (typeof first === "string" ? undefined : first.values) });
      if (options.failOn && text.includes(options.failOn)) throw new Error("boom");
      return text.startsWith("BEGIN;") ? [{ command: "BEGIN" }, {}, {}, {}, {}] : { rows: [] };
    },
    release() {
      released += 1;
    },
  };
  const pool = {
    options: { max: 4 },
    async connect() {
      return client as unknown as PoolClient;
    },
  } as unknown as Pool;
  return { pool: scopeToDbContext(pool), sent, released: () => released };
}

const settings = (text: string) =>
  Object.fromEntries([...text.matchAll(/SET LOCAL (\S+) = '([^']*)'/g)].map((m) => [m[1], m[2]]));

describe("scopeToDbContext", () => {
  it("sets the tenant inside the transaction that runs a single statement", async () => {
    const { pool, sent, released } = fakePool();
    await runAsTenant({ spaceId: "space-1", userId: "user-1" }, () =>
      pool.query("SELECT 1 WHERE $1", ["x"]),
    );
    expect(sent.map((s) => s.text.split(";")[0])).toEqual(["BEGIN", "SELECT 1 WHERE $1", "COMMIT"]);
    expect(settings(sent[0]!.text)).toEqual({
      "app.space_id": "space-1",
      "app.user_id": "user-1",
      "app.rls_bypass": "off",
      "app.rls_version": "2",
    });
    expect(sent[1]?.values).toEqual(["x"]);
    expect(released()).toBe(1);
  });

  it("applies the settings of the call that asked, not of an earlier one", async () => {
    const { pool, sent } = fakePool();
    await runAsTenant({ spaceId: "space-a", userId: "user-a" }, () => pool.query("SELECT 1"));
    await runAsTenant({ spaceId: "space-b", userId: "user-b" }, () => pool.query("SELECT 1"));
    await runAsSystem("unit test", () => pool.query("SELECT 1"));
    await pool.query("SELECT 1");
    const begins = sent.filter((s) => s.text.startsWith("BEGIN")).map((s) => settings(s.text));
    expect(begins.map((s) => s["app.space_id"])).toEqual(["space-a", "space-b", "", ""]);
    expect(begins.map((s) => s["app.rls_bypass"])).toEqual(["off", "off", "on", "off"]);
    expect(begins.every((s) => s["app.rls_version"] === "2")).toBe(true);
  });

  it("sends the settings with BEGIN of an explicit transaction, and nothing around it", async () => {
    const { pool, sent } = fakePool();
    const client = await pool.connect();
    await runAsTenant({ spaceId: "space-1", userId: "user-1" }, () =>
      client.query({ text: "BEGIN", values: [] }),
    );
    await client.query("SELECT 1");
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query("COMMIT");
    expect(sent.map((s) => s.text.split(";")[0])).toEqual([
      "BEGIN",
      "SELECT 1",
      "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
      "COMMIT",
    ]);
    expect(settings(sent[0]!.text)["app.space_id"]).toBe("space-1");
  });

  it("gives a statement on a checked-out client outside a transaction its own", async () => {
    const { pool, sent } = fakePool();
    const client = await pool.connect();
    await client.query("SELECT 1");
    await client.query("BEGIN");
    await client.query("COMMIT");
    await client.query("SELECT 2");
    expect(sent.map((s) => s.text.split(";")[0])).toEqual([
      "BEGIN",
      "SELECT 1",
      "COMMIT",
      "BEGIN",
      "COMMIT",
      "BEGIN",
      "SELECT 2",
      "COMMIT",
    ]);
  });

  it("rolls back and releases when the statement fails", async () => {
    const { pool, sent, released } = fakePool({ failOn: "FAIL" });
    await expect(pool.query("SELECT FAIL")).rejects.toThrow("boom");
    expect(sent.at(-1)?.text).toBe("ROLLBACK");
    expect(released()).toBe(1);
  });

  it("quotes ids so they cannot end the setting", async () => {
    const { pool, sent } = fakePool();
    await runAsTenant({ spaceId: "x'; SELECT 1; --", userId: "u" }, () => pool.query("SELECT 1"));
    expect(sent[0]?.text).toContain("'x''; SELECT 1; --'");
  });

  it("honours a callback as the last argument", async () => {
    const { pool } = fakePool();
    const result = await new Promise((resolve, reject) =>
      (pool.query as (...args: unknown[]) => void)(
        "SELECT 1",
        (error: Error | null, value: unknown) => (error ? reject(error) : resolve(value)),
      ),
    );
    expect(result).toEqual({ rows: [] });
  });
});
