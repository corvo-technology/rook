import { createHash } from "node:crypto";
import { recordSecurityEvent } from "@corvo/db";
import { sharedPgDatabaseDriver } from "./database-pg-driver.js";
import type { DatabaseDriver, DatabaseTarget } from "./database-query.js";
import { describeDatabase, queryDatabase } from "./database-query.js";
import type { RunContext } from "./run-context.js";
import { addRunSecrets } from "./run-context.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/** Whether any database connection is granted to the bot. An optional tool: a failed read offers none. */
export async function botHasDatabaseGrants(
  prisma: RunContext["deps"]["prisma"],
  botId: string,
  spaceId: string,
): Promise<boolean> {
  try {
    return (await prisma.botDatabaseGrant.count({ where: { botId, spaceId } })) > 0;
  } catch {
    return false;
  }
}

type Outcome = "ok" | "truncated" | "refused" | "error";

type Resolved = { target: DatabaseTarget; driver: DatabaseDriver } | { error: string };

/**
 * The connection the call names, among those granted to this agent and no others. A connection
 * that exists in the space but was not granted looks the same as one that does not exist.
 */
async function resolveGrantedConnection(ctx: RunContext, name: unknown): Promise<Resolved> {
  const { deps, bot, run } = ctx;
  const grants = await deps.prisma.botDatabaseGrant.findMany({
    where: { botId: bot.id, spaceId: run.spaceId },
    include: { connection: true },
    orderBy: { createdAt: "asc" },
  });
  const wanted = typeof name === "string" ? name.trim() : "";
  const available = grants.map((grant) => grant.connection.name);
  const grant = wanted
    ? grants.find((g) => g.connection.name === wanted || g.connection.id === wanted)
    : grants.length === 1
      ? grants[0]
      : undefined;
  if (!grant) {
    return {
      error: wanted
        ? `No database connection named "${wanted}" is available to you.${available.length ? ` Available: ${available.join(", ")}.` : ""}`
        : available.length
          ? `Pass connection. Available: ${available.join(", ")}.`
          : "No database connection is available to you.",
    };
  }
  const secret = await deps.prisma.secret.findFirst({
    where: { id: grant.connection.secretId, spaceId: run.spaceId },
  });
  if (!secret) return { error: "This database connection has no saved password." };
  let password: string;
  try {
    password = await deps.secretStore.load(secret.ciphertext, secret.id);
  } catch {
    return { error: "This database connection's password cannot be read." };
  }
  addRunSecrets(ctx, [password]);
  const c = grant.connection;
  return {
    target: {
      id: c.id,
      host: c.host,
      port: c.port,
      database: c.database,
      user: c.username,
      password,
      sslMode: c.sslMode as DatabaseTarget["sslMode"],
    },
    driver: deps.databaseDriver ?? sharedPgDatabaseDriver(deps.mcpAllowPrivateEndpoint === true),
  };
}

function audit(
  ctx: RunContext,
  event: {
    connectionId?: string;
    tool: string;
    outcome: Outcome;
    durationMs: number;
    rows?: number;
    sql?: string;
  },
) {
  // Identifiers, counts and a hash of the statement: never result data, never the statement.
  return recordSecurityEvent({
    type: "database.query",
    userId: ctx.run.userId,
    spaceId: ctx.run.spaceId,
    metadata: {
      connectionId: event.connectionId,
      botId: ctx.bot.id,
      runId: ctx.runId,
      tool: event.tool,
      outcome: event.outcome,
      durationMs: event.durationMs,
      rows: event.rows,
      statementHash: event.sql
        ? createHash("sha256").update(event.sql).digest("hex").slice(0, 16)
        : undefined,
    },
  });
}

/** Read-only queries against the databases granted to this agent. */
export const databaseTools: ToolHandlers = {
  async query_database(ctx, call) {
    const started = Date.now();
    ctx.context.signal.throwIfAborted();
    const sql = typeof call.args.sql === "string" ? call.args.sql : "";
    const resolved = await resolveGrantedConnection(ctx, call.args.connection);
    if ("error" in resolved) return { error: resolved.error };
    const result = await queryDatabase(resolved.driver, resolved.target, sql);
    const outcome: Outcome =
      "error" in result
        ? result.refused
          ? "refused"
          : "error"
        : result.truncated
          ? "truncated"
          : "ok";
    await audit(ctx, {
      connectionId: resolved.target.id,
      tool: "query_database",
      outcome,
      durationMs: Date.now() - started,
      rows: "error" in result ? undefined : result.rowCount,
      sql,
    });
    if ("error" in result) return { error: result.error };
    const { kind: _kind, refused: _refused, ...shown } = result;
    return shown;
  },
  async describe_database(ctx, call) {
    const started = Date.now();
    ctx.context.signal.throwIfAborted();
    const resolved = await resolveGrantedConnection(ctx, call.args.connection);
    if ("error" in resolved) return { error: resolved.error };
    const text = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim().slice(0, 128) : undefined;
    const result = await describeDatabase(resolved.driver, resolved.target, {
      schema: text(call.args.schema),
      table: text(call.args.table),
    });
    await audit(ctx, {
      connectionId: resolved.target.id,
      tool: "describe_database",
      outcome: "error" in result ? "error" : result.truncated ? "truncated" : "ok",
      durationMs: Date.now() - started,
      rows: "error" in result ? undefined : result.tables.length,
    });
    return result;
  },
};
