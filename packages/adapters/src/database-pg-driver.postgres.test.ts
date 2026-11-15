import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgDatabaseDriver } from "./database-pg-driver.js";
import type { DatabaseTarget } from "./database-query.js";
import { describeDatabase, queryDatabase, runReadOnly } from "./database-query.js";

const postgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

function targetFromEnv(): DatabaseTarget {
  const url = new URL(process.env.DATABASE_URL!);
  return {
    id: "pg-readonly-test",
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslMode: "disable",
  };
}

postgres("the read-only PostgreSQL driver (PostgreSQL)", () => {
  const driver = createPgDatabaseDriver({ allowPrivate: true });
  let target: DatabaseTarget;
  beforeAll(() => {
    target = targetFromEnv();
  });
  afterAll(() => driver.close());

  it("returns rows with column names", async () => {
    const result = await queryDatabase(
      driver,
      target,
      "select n, n * 2 as double from generate_series(1, 3) n",
    );
    expect(result).toMatchObject({
      columns: ["n", "double"],
      rows: [
        [1, 2],
        [2, 4],
        [3, 6],
      ],
      rowCount: 3,
      truncated: false,
    });
  });

  it("caps rows without reading the rest", async () => {
    const result = await queryDatabase(
      driver,
      target,
      "select n from generate_series(1, 100000) n",
    );
    expect(result).toMatchObject({ rowCount: 500, truncated: true });
  });

  it("runs EXPLAIN", async () => {
    const result = await queryDatabase(driver, target, "explain select 1");
    expect(result).toMatchObject({ kind: "explain", truncated: false });
  });

  it("refuses writes inside the transaction even when the statement gate is bypassed", async () => {
    await expect(
      runReadOnly(driver, target, { sql: "create table corvo_should_not_exist (id int)" }),
    ).rejects.toThrow(/read-only/);
    await expect(
      runReadOnly(driver, target, {
        sql: "select set_config('default_transaction_read_only', 'off', true)",
      }).then(() =>
        runReadOnly(driver, target, { sql: "select current_setting('transaction_read_only')" }),
      ),
    ).resolves.toMatchObject({ rows: [["on"]] });
  });

  it("lets the server refuse a second statement", async () => {
    await expect(runReadOnly(driver, target, { sql: "select 1; select 2" })).rejects.toThrow(
      /multiple commands/,
    );
  });

  it("stops a statement at the timeout and leaves the connection usable", async () => {
    await expect(
      runReadOnly(
        driver,
        target,
        { sql: "select pg_sleep(5)" },
        { statementTimeoutMs: 200, maxRows: 10, maxBytes: 1000, maxCellChars: 50 },
      ),
    ).rejects.toThrow(/statement timeout/);
    const after = await queryDatabase(driver, target, "select 1 as ok");
    expect(after).toMatchObject({ rows: [[1]] });
  });

  it("rolls back: the session is clean for the next query", async () => {
    const mode = await queryDatabase(
      driver,
      target,
      "select current_setting('transaction_read_only') as ro",
    );
    expect(mode).toMatchObject({ rows: [["on"]] });
  });

  it("describes the tables the role can see", async () => {
    const result = await describeDatabase(driver, target, { schema: "pg_catalog" });
    expect(result).toMatchObject({ tables: [], truncated: false });
    const all = await describeDatabase(driver, target);
    expect("error" in all).toBe(false);
  });

  it("refuses a wrong password with a message that does not echo it", async () => {
    const result = await queryDatabase(
      createPgDatabaseDriver({ allowPrivate: true }),
      { ...target, id: "wrong-pw", password: "not-the-password-xyz" },
      "select 1",
    );
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("not-the-password-xyz");
  });

  it("refuses a private host unless the deployment allows it", async () => {
    const strict = createPgDatabaseDriver({ allowPrivate: false });
    try {
      const result = await queryDatabase(strict, { ...target, id: "strict" }, "select 1");
      expect(result).toMatchObject({ error: expect.stringMatching(/private/) });
    } finally {
      await strict.close();
    }
  });
});
