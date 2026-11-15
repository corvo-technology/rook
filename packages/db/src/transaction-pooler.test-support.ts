import { PrismaPg } from "@prisma/adapter-pg";
import type { QueryConfig, QueryResult } from "pg";
import pg from "pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { scopeToDbContext, withRowLevelSecurity } from "./row-security.js";

/**
 * A stand-in for a PgBouncer-style pooler in transaction mode, at the `pg` client boundary: every
 * client the application checks out is virtual, and each of its transactions (or each statement
 * outside one) runs on whichever server connection is free, the one idle the longest first. So
 * two transactions of one client usually run on different server connections, and session state
 * set by one is seen by another client's next transaction, as it is behind a real pooler.
 */
export function createTransactionPooler(url: string, serverConnections = 3) {
  const servers: pg.Client[] = [];
  const idle: pg.Client[] = [];
  const waiting: Array<(server: pg.Client) => void> = [];

  const acquire = (): Promise<pg.Client> => {
    const server = idle.shift();
    return server ? Promise.resolve(server) : new Promise((resolve) => waiting.push(resolve));
  };
  const release = (server: pg.Client) => {
    const next = waiting.shift();
    if (next) next(server);
    else idle.push(server);
  };

  const startsTransaction = (text: string) => /^\s*(begin|start\s+transaction)\b/i.test(text);
  const endsTransaction = (text: string) => /^\s*(commit|end|rollback)\b(?!\s+to\b)/i.test(text);

  class PooledClient extends pg.Client {
    private pinned: pg.Client | undefined;

    override query(...args: any[]): any {
      const first = args[0];
      const text: string = typeof first === "string" ? first : (first as QueryConfig).text;
      return this.route(text, args);
    }

    private async route(text: string, args: any[]): Promise<QueryResult> {
      const server = this.pinned ?? (await acquire());
      if (startsTransaction(text)) this.pinned = server;
      try {
        return await (server.query as (...a: unknown[]) => Promise<QueryResult>)(...args);
      } finally {
        if (endsTransaction(text)) this.pinned = undefined;
        if (!this.pinned) release(server);
      }
    }
  }

  return {
    /** A pool whose connections all go through the simulated pooler. */
    createPool(max = 4): pg.Pool {
      return new pg.Pool({ connectionString: url, max, Client: PooledClient });
    },
    async open() {
      for (let i = 0; i < serverConnections; i += 1) {
        const server = new pg.Client({ connectionString: url });
        await server.connect();
        servers.push(server);
        idle.push(server);
      }
    },
    /** The `app.*` settings each server connection holds between transactions. */
    async serverSettings(): Promise<Array<Record<string, string>>> {
      const rows: Array<Record<string, string>> = [];
      for (const server of servers) {
        const { rows: found } = await server.query(
          `SELECT current_setting('app.space_id', true) AS space_id,
                  current_setting('app.user_id', true) AS user_id,
                  current_setting('app.rls_bypass', true) AS bypass`,
        );
        rows.push(found[0]);
      }
      return rows;
    },
    async close() {
      await Promise.all(servers.map((server) => server.end()));
    },
  };
}

/** The application's database client, composed as createDb does, on a pool behind the pooler. */
export function createPooledDb(pool: pg.Pool): PrismaClient {
  return withRowLevelSecurity(new PrismaClient({ adapter: new PrismaPg(scopeToDbContext(pool)) }));
}
