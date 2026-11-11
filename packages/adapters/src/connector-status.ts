/**
 * Reads "this is still being made" out of a structured connector result. Only enum-like field
 * values are compared, by exact equality against this table; prose is never classified.
 */
export const CONNECTOR_STATUS_TABLE = {
  version: 1,
  stateFields: [
    "state",
    "status",
    "life_cycle_state",
    "lifecycle_state",
    "run_state",
    "statement_state",
    "job_state",
    "execution_status",
  ],
  notDoneStates: [
    "pending",
    "queued",
    "running",
    "in_progress",
    "starting",
    "submitted",
    "scheduled",
    "waiting",
    "processing",
    "accepted",
  ],
  idExactKeys: ["id"],
  idSuffixes: ["_id", "Id"],
  maxDepth: 6,
  maxIdLength: 200,
} as const;

export type ConnectorStatusId = string | number;

export interface ConnectorStatus {
  /** The state value upper-cased as it reads. */
  state: string;
  pending: boolean;
  /** Id fields by name; the first occurrence wins. */
  ids: Record<string, ConnectorStatusId>;
}

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string): PlainObject | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The structured object of a result, or undefined when it has none or is an error. */
function structuredObject(result: unknown): PlainObject | undefined {
  if (!isPlainObject(result) || result.isError === true) return undefined;
  const structured = isPlainObject(result.structuredContent) ? result.structuredContent : undefined;
  if (structured) return structured;
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (isPlainObject(part) && part.type === "text" && typeof part.text === "string") {
        const parsed = parseJsonObject(part.text);
        if (parsed) return parsed;
      }
    }
    return undefined;
  }
  return result;
}

function isIdKey(key: string): boolean {
  return (
    (CONNECTOR_STATUS_TABLE.idExactKeys as readonly string[]).includes(key) ||
    CONNECTOR_STATUS_TABLE.idSuffixes.some((suffix) => key.endsWith(suffix))
  );
}

function idValue(value: unknown): ConnectorStatusId | undefined {
  if (typeof value === "string")
    return value.length >= 1 && value.length <= CONNECTOR_STATUS_TABLE.maxIdLength
      ? value
      : undefined;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** Nested objects breadth-first, never arrays, root first. */
function* objectsBreadthFirst(root: PlainObject): Generator<PlainObject> {
  let level: PlainObject[] = [root];
  for (let depth = 0; depth <= CONNECTOR_STATUS_TABLE.maxDepth && level.length; depth++) {
    const next: PlainObject[] = [];
    for (const object of level) {
      yield object;
      for (const value of Object.values(object)) if (isPlainObject(value)) next.push(value);
    }
    level = next;
  }
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase().replaceAll("-", "_");
}

export function readConnectorStatus(result: unknown): ConnectorStatus | undefined {
  const root = structuredObject(result);
  if (!root || "error" in root) return undefined;
  const stateFields: readonly string[] = CONNECTOR_STATUS_TABLE.stateFields;
  let state: string | undefined;
  const ids: Record<string, ConnectorStatusId> = {};
  for (const object of objectsBreadthFirst(root)) {
    for (const [key, value] of Object.entries(object)) {
      if (state === undefined && stateFields.includes(key) && typeof value === "string")
        state = value;
      if (isIdKey(key) && !(key in ids)) {
        const id = idValue(value);
        if (id !== undefined) ids[key] = id;
      }
    }
  }
  if (state === undefined || Object.keys(ids).length === 0) return undefined;
  const notDone: readonly string[] = CONNECTOR_STATUS_TABLE.notDoneStates;
  return {
    state: state.trim().toUpperCase(),
    pending: notDone.includes(normalizeState(state)),
    ids,
  };
}
