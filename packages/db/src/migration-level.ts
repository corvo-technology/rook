import { readdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

/** Newest migration folder (`<timestamp>_<name>`) the release ships. */
export async function latestMigrationName(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
}

export type MigrationWait = {
  /** Runs one query on the runtime login. */
  query: (sql: string, values: string[]) => Promise<{ rowCount: number | null }>;
  /** Releases the wait early, for a shutdown. */
  signal?: AbortSignal;
  timeoutMs?: number;
  intervalMs?: number;
  log?: (message: string, fields: Record<string, unknown>) => void;
};

/**
 * Migrations run when the API starts, while the worker of the same release boots in parallel.
 * Until the newest migration is recorded, new code can query columns that do not exist yet, so
 * the worker waits here. Any failure to read the record (table missing, grant not yet applied,
 * connection) counts as "not yet". After the bound it proceeds with a warning, as it would have
 * without the gate, rather than stay down on a migration that is stuck.
 */
export async function waitForMigrationLevel(
  expected: string,
  options: MigrationWait,
): Promise<"ready" | "timeout" | "aborted"> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const startedAt = Date.now();
  let announced = false;
  for (;;) {
    if (options.signal?.aborted) return "aborted";
    let reason = "not applied yet";
    try {
      const result = await options.query(
        `SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = $1 AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
        [expected],
      );
      if (result.rowCount) {
        if (announced) options.log?.("database migrations applied", { migration: expected });
        return "ready";
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= timeoutMs) {
      options.log?.("starting without the expected database migration", {
        migration: expected,
        waitedMs,
        reason,
      });
      return "timeout";
    }
    if (!announced) {
      announced = true;
      options.log?.("waiting for the database migration", { migration: expected, reason });
    }
    await sleep(Math.min(intervalMs, timeoutMs - waitedMs), undefined, {
      signal: options.signal,
    }).catch(() => undefined);
  }
}
