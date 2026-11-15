import { createHash } from "node:crypto";
import { isIP } from "node:net";
import pg from "pg";
import Cursor from "pg-cursor";
import type { DatabaseEgressPolicy } from "./database-egress.js";
import { resolveDatabaseAddress } from "./database-egress.js";
import type { DatabaseDriver, DatabaseSession, DatabaseTarget } from "./database-query.js";

const POOL_MAX_CLIENTS = 2;
const CLIENT_IDLE_MS = 30_000;
const POOL_IDLE_MS = 5 * 60_000;
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 20_000;
const MAX_POOLS = 32;

interface PooledTarget {
  pool: pg.Pool;
  connectionId: string;
  lastUsed: number;
}

function poolKey(target: DatabaseTarget, address: string): string {
  const secret = createHash("sha256").update(target.password).digest("hex").slice(0, 16);
  return [
    target.id,
    address,
    target.port,
    target.database,
    target.user,
    target.sslMode,
    secret,
  ].join("|");
}

function sslFor(target: DatabaseTarget): pg.ClientConfig["ssl"] {
  if (target.sslMode === "disable") return false;
  return {
    rejectUnauthorized: target.sslMode === "verify-full",
    // Connecting to the resolved address, the certificate is still checked against the name.
    ...(isIP(target.host) ? {} : { servername: target.host }),
  };
}

/**
 * The PostgreSQL driver: a small pool per saved connection, connecting to an address this code
 * resolved and checked itself, with TLS verified against the name the person entered.
 */
const defaults = new Map<boolean, DatabaseDriver>();

/** One shared driver per process and policy, so a connection keeps one small pool. */
export function sharedPgDatabaseDriver(allowPrivate: boolean): DatabaseDriver {
  let driver = defaults.get(allowPrivate);
  if (!driver) {
    driver = createPgDatabaseDriver({ allowPrivate });
    defaults.set(allowPrivate, driver);
  }
  return driver;
}

export function createPgDatabaseDriver(egress: DatabaseEgressPolicy): DatabaseDriver {
  const pools = new Map<string, PooledTarget>();

  const closeQuietly = (entry: PooledTarget) => entry.pool.end().catch(() => undefined);

  const sweep = setInterval(() => {
    const cutoff = Date.now() - POOL_IDLE_MS;
    for (const [key, entry] of pools) {
      if (entry.lastUsed < cutoff && entry.pool.totalCount === entry.pool.idleCount) {
        pools.delete(key);
        void closeQuietly(entry);
      }
    }
  }, 60_000);
  sweep.unref();

  function poolFor(target: DatabaseTarget, address: string): PooledTarget {
    const key = poolKey(target, address);
    const existing = pools.get(key);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }
    // Same connection, different address, password or settings: the old pool is stale.
    for (const [otherKey, other] of pools) {
      if (other.connectionId === target.id) {
        pools.delete(otherKey);
        void closeQuietly(other);
      }
    }
    while (pools.size >= MAX_POOLS) {
      const oldest = [...pools.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) break;
      pools.delete(oldest[0]);
      void closeQuietly(oldest[1]);
    }
    const pool = new pg.Pool({
      host: address,
      port: target.port,
      database: target.database,
      user: target.user,
      password: target.password,
      ssl: sslFor(target),
      max: POOL_MAX_CLIENTS,
      idleTimeoutMillis: CLIENT_IDLE_MS,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      application_name: "corvo-readonly",
      allowExitOnIdle: true,
    });
    // An idle client dropped by the server must not crash the process.
    pool.on("error", () => undefined);
    const entry = { pool, connectionId: target.id, lastUsed: Date.now() };
    pools.set(key, entry);
    return entry;
  }

  return {
    async session(target, run) {
      const address = await resolveDatabaseAddress(target.host, egress);
      const { pool } = poolFor(target, address);
      const client = await pool.connect();
      let failed = false;
      const session: DatabaseSession = {
        async exec(sql) {
          await client.query(sql);
        },
        async read(sql, limit, values) {
          const cursor = client.query(new Cursor(sql, values, { rowMode: "array" }));
          try {
            const rows = (await cursor.read(limit + 1)) as unknown[][];
            const columns = (
              cursor as unknown as { _result?: { fields?: Array<{ name: string }> } }
            )._result?.fields?.map((field) => field.name);
            return {
              columns: columns ?? [],
              rows: rows.slice(0, limit) as unknown[][],
              more: rows.length > limit,
            };
          } finally {
            await new Promise<void>((resolve) => cursor.close(() => resolve()));
          }
        },
      };
      try {
        return await run(session);
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        // A client that failed mid-transaction is destroyed, not handed to the next query.
        client.release(failed);
      }
    },
    async evict(connectionId) {
      for (const [key, entry] of pools) {
        if (entry.connectionId !== connectionId) continue;
        pools.delete(key);
        await closeQuietly(entry);
      }
    },
    async close() {
      clearInterval(sweep);
      const entries = [...pools.values()];
      pools.clear();
      await Promise.all(entries.map(closeQuietly));
    },
  };
}
