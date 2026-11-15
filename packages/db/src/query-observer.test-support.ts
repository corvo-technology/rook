import type { Pool, PoolClient, QueryResult } from "pg";

/**
 * Calls `observe` with the arguments and result of every statement run on a client checked out of
 * `pool`. The application's own client checks its connections out of the pool (it does not call
 * `pool.query`), so this is where its statements can be watched.
 */
export function observeQueries(
  pool: Pool,
  observe: (args: unknown[], result: QueryResult) => void,
): void {
  const wrapped = new WeakSet<PoolClient>();
  const connect = pool.connect.bind(pool) as () => Promise<PoolClient>;
  pool.connect = (async () => {
    const client = await connect();
    // A pooled client comes back on every checkout; wrap its query once.
    if (wrapped.has(client)) return client;
    wrapped.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    client.query = ((...args: unknown[]) => {
      const result = original(...args);
      if (!result || typeof (result as Promise<unknown>).then !== "function") return result;
      return (result as Promise<QueryResult>).then((queryResult) => {
        if (queryResult && !Array.isArray(queryResult)) observe(args, queryResult);
        return queryResult;
      });
    }) as PoolClient["query"];
    return client;
  }) as Pool["connect"];
}
