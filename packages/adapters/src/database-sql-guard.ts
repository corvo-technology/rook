import { parse } from "pgsql-ast-parser";

/**
 * The statement gate of the read-only database tools. It is one layer of several: the query
 * also runs in a read-only transaction and, when the company follows the advice, under a
 * read-only role. This layer exists so an unclassifiable or dangerous statement is refused
 * before it reaches the database, and the model hears why.
 */

export const MAX_SQL_LENGTH = 20_000;

export type SqlVerdict =
  | { ok: true; kind: "select" | "explain"; sql: string }
  | { ok: false; reason: string };

/** Statement nodes a SELECT may contain. Anything else with a statement type is refused. */
const READ_STATEMENT_TYPES = new Set(["select", "union", "union all", "with", "values"]);

/**
 * Functions refused by name, whatever schema they are called under: they write, read files,
 * wait, take locks, change settings, reach other servers, or run SQL given as text, which no
 * parser can look inside. The read-only transaction stops most of these too.
 */
const DENIED_FUNCTIONS = new Set([
  "set_config",
  "nextval",
  "setval",
  "pg_notify",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_switch_wal",
  "pg_promote",
  "pg_stat_file",
  "pg_ls_dir",
  "pg_current_logfile",
  "pg_import_system_collations",
  "pg_stat_reset",
  "pg_stat_reset_shared",
  "pg_stat_reset_single_table_counters",
  "pg_stat_reset_single_function_counters",
  "pg_replication_slot_advance",
  "pg_create_restore_point",
  "pg_start_backup",
  "pg_stop_backup",
  "pg_backup_start",
  "pg_backup_stop",
  "pg_export_snapshot",
  "ts_stat",
  "query_to_xml",
  "query_to_xmlschema",
  "query_to_xml_and_xmlschema",
  "cursor_to_xml",
  "cursor_to_xmlschema",
  "table_to_xml",
  "table_to_xmlschema",
  "table_to_xml_and_xmlschema",
  "schema_to_xml",
  "schema_to_xmlschema",
  "schema_to_xml_and_xmlschema",
  "database_to_xml",
  "database_to_xmlschema",
  "database_to_xml_and_xmlschema",
]);

/** Families of functions refused by name prefix. */
const DENIED_FUNCTION_PREFIXES = [
  "pg_sleep",
  "pg_read_",
  "pg_ls_",
  "pg_file_",
  "pg_logdir_",
  "pg_advisory_",
  "pg_try_advisory_",
  "pg_create_",
  "pg_drop_",
  "pg_copy_",
  "pg_replication_origin_",
  "pg_logical_",
  "pg_wal_replay_",
  "dblink",
  "postgres_fdw",
];

/** Large-object functions, which read and write server files. */
const LARGE_OBJECT_FUNCTION =
  /^(lo_(import|export|open|creat|create|unlink|get|put|from_bytea|lseek|lseek64|tell|tell64|truncate|truncate64|close)|loread|lowrite)$/;

function deniedFunction(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    DENIED_FUNCTIONS.has(lower) ||
    LARGE_OBJECT_FUNCTION.test(lower) ||
    DENIED_FUNCTION_PREFIXES.some((p) => lower.startsWith(p))
  );
}

/** Option names `EXPLAIN (...)` may carry. ANALYZE runs the statement, so it is not here. */
const EXPLAIN_OPTION = /^(verbose|costs|settings|buffers|summary|format\s+(text|json|yaml|xml))$/i;

/**
 * Cuts a leading `EXPLAIN` off the statement and returns what it explains, or a refusal. The
 * parser does not know EXPLAIN, so what follows is parsed and classified like any statement.
 */
function stripExplain(sql: string): { inner: string } | { reason: string } | null {
  const head = /^explain\b\s*/i.exec(sql);
  if (!head) return null;
  let rest = sql.slice(head[0].length);
  if (rest.startsWith("(")) {
    const close = rest.indexOf(")");
    if (close < 0) return { reason: "EXPLAIN options are not closed" };
    const options = rest
      .slice(1, close)
      .split(",")
      .map((option) => option.trim());
    if (!options.every((option) => EXPLAIN_OPTION.test(option))) {
      return { reason: "EXPLAIN is allowed without ANALYZE and with plain display options only" };
    }
    rest = rest.slice(close + 1).trimStart();
  } else {
    const plain = /^(verbose\b\s*)/i.exec(rest);
    if (plain) rest = rest.slice(plain[0].length);
  }
  return { inner: rest };
}

function blockedWord(sql: string): string | undefined {
  // Quotes are dropped so "pg_sleep"(1) and pg_sleep(1) look the same; a hit inside a string
  // literal refuses a harmless query, which is the safe way to be wrong.
  const flat = sql.toLowerCase().replaceAll('"', "");
  for (const match of flat.matchAll(/[a-z_][a-z0-9_$]*/g)) {
    if (deniedFunction(match[0])) return match[0];
  }
  return undefined;
}

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

/** Walks the whole tree, so a call or a nested statement is found wherever it sits. */
function inspect(value: unknown, depth = 0): string | undefined {
  if (depth > 200) return "The statement is nested too deeply";
  if (Array.isArray(value)) {
    for (const item of value) {
      const refusal = inspect(item, depth + 1);
      if (refusal) return refusal;
    }
    return undefined;
  }
  if (!isNode(value)) return undefined;
  const type = value.type;
  if (type === "call") {
    const fn = value.function;
    if (isNode(fn) && typeof fn.name === "string" && deniedFunction(fn.name)) {
      return `The function ${fn.name} is not allowed`;
    }
  }
  if (type === "select" && value.for) return "Row locks (FOR UPDATE/SHARE) are not allowed";
  if (
    typeof type === "string" &&
    ["insert", "update", "delete", "truncate", "copy", "set", "show", "do"].includes(type)
  ) {
    return `${type.toUpperCase()} is not allowed`;
  }
  for (const child of Object.values(value)) {
    const refusal = inspect(child, depth + 1);
    if (refusal) return refusal;
  }
  return undefined;
}

/** Decide whether `input` is one read-only statement. Anything not understood is refused. */
export function checkReadOnlySql(input: string): SqlVerdict {
  const sql = input
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (!sql) return { ok: false, reason: "The statement is empty" };
  if (sql.length > MAX_SQL_LENGTH) return { ok: false, reason: "The statement is too long" };
  if (sql.includes("\0")) return { ok: false, reason: "The statement is not valid text" };

  const explained = stripExplain(sql);
  if (explained && "reason" in explained) return { ok: false, reason: explained.reason };
  const body = explained ? explained.inner : sql;

  let statements: ReturnType<typeof parse>;
  try {
    statements = parse(body);
  } catch {
    return {
      ok: false,
      reason:
        "That statement could not be understood. Use a single plain SELECT, or WITH ... SELECT.",
    };
  }
  if (statements.length !== 1) {
    return { ok: false, reason: "Exactly one statement is allowed" };
  }
  const [statement] = statements;
  if (!statement || !READ_STATEMENT_TYPES.has(statement.type)) {
    return { ok: false, reason: "Only SELECT, WITH ... SELECT and EXPLAIN are allowed" };
  }
  // A data-modifying CTE hangs under a SELECT, so the whole tree is checked, not the top.
  const refusal = inspect(statement);
  if (refusal) return { ok: false, reason: refusal };
  const word = blockedWord(body);
  if (word) return { ok: false, reason: `The function ${word} is not allowed` };
  return { ok: true, kind: explained ? "explain" : "select", sql };
}
