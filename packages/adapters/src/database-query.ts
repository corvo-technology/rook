import type { DatabaseSslMode } from "@corvo/contracts";
import { checkReadOnlySql } from "./database-sql-guard.js";

/** Where and as whom to connect. The password is plaintext here and nowhere else. */
export interface DatabaseTarget {
  /** Identifies the saved connection, so one pool serves it. */
  id: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  sslMode: DatabaseSslMode;
}

export interface DatabaseRows {
  columns: string[];
  rows: unknown[][];
  /** The database had more rows than were asked for. */
  more: boolean;
}

/** One checked-out connection. Everything the model's SQL does goes through `read`. */
export interface DatabaseSession {
  /** A statement this code wrote: BEGIN, SET LOCAL, ROLLBACK. */
  exec(sql: string): Promise<void>;
  /** The statement alone, through the extended protocol so the server refuses a second one. */
  read(sql: string, limit: number, values?: unknown[]): Promise<DatabaseRows>;
}

/** The only place a vendor driver lives. Tests supply a fake one. */
export interface DatabaseDriver {
  session<T>(target: DatabaseTarget, run: (session: DatabaseSession) => Promise<T>): Promise<T>;
  /** Close the pools of one connection, after it is edited or removed. */
  evict(connectionId: string): Promise<void>;
  close(): Promise<void>;
}

export interface QueryLimits {
  statementTimeoutMs: number;
  maxRows: number;
  maxBytes: number;
  maxCellChars: number;
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = {
  statementTimeoutMs: 15_000,
  maxRows: 500,
  maxBytes: 40_000,
  maxCellChars: 500,
};

export type QueryResult =
  | {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
      /** Tells the model why rows are missing, so it narrows the query instead of guessing. */
      note?: string;
    }
  | { error: string };

/** Values the model reads: plain JSON, with long text and binary shortened. */
export function jsonCell(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  const text = typeof value === "string" ? value : safeJson(value);
  return text.length > maxChars ? `${text.slice(0, maxChars)}… (${text.length} chars)` : text;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function shape(rows: DatabaseRows, limits: QueryLimits): QueryResult {
  const kept: unknown[][] = [];
  let bytes = rows.columns.join(",").length;
  let cut: "rows" | "bytes" | undefined = rows.more ? "rows" : undefined;
  for (const row of rows.rows.slice(0, limits.maxRows)) {
    const cells = row.map((cell) => jsonCell(cell, limits.maxCellChars));
    bytes += safeJson(cells).length;
    if (bytes > limits.maxBytes && kept.length > 0) {
      cut = "bytes";
      break;
    }
    kept.push(cells);
  }
  if (rows.rows.length > kept.length && !cut) cut = "rows";
  const truncated = cut !== undefined;
  return {
    columns: rows.columns,
    rows: kept,
    rowCount: kept.length,
    truncated,
    ...(truncated
      ? {
          note:
            cut === "bytes"
              ? `Showing the first ${kept.length} rows; the rest did not fit. Select fewer columns or add filters, LIMIT or aggregation.`
              : `Showing the first ${kept.length} rows; there are more. Add filters, LIMIT or aggregation.`,
        }
      : {}),
  };
}

/** Keeps a password out of any message that carries it. */
export function redactDatabaseError(error: unknown, secrets: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    if (secret.length >= 4) message = message.split(secret).join("[redacted]");
  }
  return message
    .replace(/(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s]*@/gi, "$1[redacted]@")
    .slice(0, 500);
}

/**
 * Run `sql` inside a read-only transaction that is always rolled back. The database enforces
 * the timeouts and the read-only mode; `checkReadOnlySql` has already refused what it can
 * recognize, and the extended protocol refuses a second statement.
 */
export async function runReadOnly(
  driver: DatabaseDriver,
  target: DatabaseTarget,
  statement: { sql: string; values?: unknown[] },
  limits: QueryLimits = DEFAULT_QUERY_LIMITS,
): Promise<DatabaseRows> {
  return driver.session(target, async (session) => {
    await session.exec("BEGIN READ ONLY");
    try {
      await session.exec(`SET LOCAL statement_timeout = ${Math.trunc(limits.statementTimeoutMs)}`);
      await session.exec(
        `SET LOCAL idle_in_transaction_session_timeout = ${Math.trunc(limits.statementTimeoutMs * 2)}`,
      );
      await session.exec("SET LOCAL default_transaction_read_only = on");
      // One more than the cap tells whether the cap cut anything.
      return await session.read(statement.sql, limits.maxRows + 1, statement.values);
    } finally {
      await session.exec("ROLLBACK").catch(() => undefined);
    }
  });
}

/** The model's query: checked, run read-only, capped, and shaped for the context window. */
export async function queryDatabase(
  driver: DatabaseDriver,
  target: DatabaseTarget,
  sql: string,
  limits: QueryLimits = DEFAULT_QUERY_LIMITS,
): Promise<QueryResult & { kind?: "select" | "explain"; refused?: boolean }> {
  const verdict = checkReadOnlySql(sql);
  if (!verdict.ok) return { error: verdict.reason, refused: true };
  try {
    const rows = await runReadOnly(driver, target, { sql: verdict.sql }, limits);
    return { ...shape(rows, limits), kind: verdict.kind };
  } catch (error) {
    return { error: redactDatabaseError(error, [target.password]) };
  }
}

const DESCRIBE_SQL = `SELECT c.table_schema, c.table_name, c.column_name, c.data_type
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
  AND c.table_schema NOT LIKE 'pg\\_%'
  AND ($1::text IS NULL OR c.table_schema = $1)
  AND ($2::text IS NULL OR c.table_name = $2)
ORDER BY c.table_schema, c.table_name, c.ordinal_position`;

const DESCRIBE_MAX_COLUMNS = 3_000;
const DESCRIBE_MAX_CHARS = 12_000;

export type DescribeResult =
  | { tables: Array<{ table: string; columns: string[] }>; truncated: boolean; note?: string }
  | { error: string };

/** Schemas, tables and columns the connection's role can see, fit for writing SQL from. */
export async function describeDatabase(
  driver: DatabaseDriver,
  target: DatabaseTarget,
  filter: { schema?: string; table?: string } = {},
  limits: QueryLimits = DEFAULT_QUERY_LIMITS,
): Promise<DescribeResult> {
  let rows: DatabaseRows;
  try {
    rows = await runReadOnly(
      driver,
      target,
      { sql: DESCRIBE_SQL, values: [filter.schema ?? null, filter.table ?? null] },
      { ...limits, maxRows: DESCRIBE_MAX_COLUMNS },
    );
  } catch (error) {
    return { error: redactDatabaseError(error, [target.password]) };
  }
  const tables = new Map<string, string[]>();
  for (const [schema, table, column, type] of rows.rows.slice(0, DESCRIBE_MAX_COLUMNS)) {
    const key = `${String(schema)}.${String(table)}`;
    const columns = tables.get(key) ?? [];
    columns.push(`${String(column)} ${String(type)}`);
    tables.set(key, columns);
  }
  const out: Array<{ table: string; columns: string[] }> = [];
  let chars = 0;
  let cut = rows.more || rows.rows.length > DESCRIBE_MAX_COLUMNS;
  for (const [table, columns] of tables) {
    chars += table.length + columns.join(", ").length;
    if (chars > DESCRIBE_MAX_CHARS) {
      cut = true;
      break;
    }
    out.push({ table, columns });
  }
  return {
    tables: out,
    truncated: cut,
    ...(cut ? { note: "The list is cut. Pass schema or table to look at one place." } : {}),
  };
}
