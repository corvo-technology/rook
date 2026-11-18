import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { latestMigrationName, waitForMigrationLevel } from "./migration-level.js";

describe("latestMigrationName", () => {
  it("is the newest migration folder", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "migrations-"));
    for (const name of ["20261101000000_a", "20261206000000_c", "20261110000000_b"]) {
      await mkdir(path.join(dir, name));
    }
    await writeFile(path.join(dir, "migration_lock.toml"), "");
    expect(await latestMigrationName(dir)).toBe("20261206000000_c");
  });
});

describe("waitForMigrationLevel", () => {
  const fast = { intervalMs: 5 };

  it("returns at once when the migration is recorded", async () => {
    const logs: string[] = [];
    const outcome = await waitForMigrationLevel("20261206000000_c", {
      ...fast,
      query: async () => ({ rowCount: 1 }),
      log: (message) => logs.push(message),
    });
    expect(outcome).toBe("ready");
    expect(logs).toEqual([]);
  });

  it("holds until the API has applied it, through a missing table and a missing grant", async () => {
    const answers: (() => { rowCount: number })[] = [
      () => {
        throw new Error('relation "_prisma_migrations" does not exist');
      },
      () => {
        throw new Error("permission denied for table _prisma_migrations");
      },
      () => ({ rowCount: 0 }),
      () => ({ rowCount: 1 }),
    ];
    let calls = 0;
    const logs: string[] = [];
    const outcome = await waitForMigrationLevel("20261206000000_c", {
      ...fast,
      query: async (_sql, values) => {
        expect(values).toEqual(["20261206000000_c"]);
        return answers[calls++]!();
      },
      log: (message) => logs.push(message),
    });
    expect(outcome).toBe("ready");
    expect(calls).toBe(4);
    expect(logs).toEqual(["waiting for the database migration", "database migrations applied"]);
  });

  it("starts anyway after the bound, saying so", async () => {
    const logs: string[] = [];
    const outcome = await waitForMigrationLevel("20261206000000_c", {
      intervalMs: 5,
      timeoutMs: 30,
      query: async () => ({ rowCount: 0 }),
      log: (message) => logs.push(message),
    });
    expect(outcome).toBe("timeout");
    expect(logs.at(-1)).toBe("starting without the expected database migration");
  });

  it("stops waiting when aborted", async () => {
    const abort = new AbortController();
    const pending = waitForMigrationLevel("x", {
      intervalMs: 1_000,
      query: async () => ({ rowCount: 0 }),
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 20);
    await expect(pending).resolves.toBe("aborted");
  });
});
