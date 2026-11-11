import type { ConnectorTool } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  brokenJson,
  buildQueued,
  errorPending,
  jobRunningPlain,
  noIdRunning,
  prosePending,
  rowsWithPending,
  sqlCanceled,
  sqlFailed,
  sqlPendingText,
  sqlRunningStructured,
  sqlSucceeded,
  ticketInProgress,
} from "./connector-status.fixtures.js";
import { CONNECTOR_STATUS_TABLE, findStatusTool, readConnectorStatus } from "./connector-status.js";

describe("readConnectorStatus", () => {
  it("reads a pending state out of MCP text JSON", () => {
    expect(readConnectorStatus(sqlPendingText)).toEqual({
      state: "PENDING",
      pending: true,
      ids: { statement_id: "stmt-0001" },
    });
  });

  it("reads structuredContent, plain objects and simple statuses", () => {
    expect(readConnectorStatus(sqlRunningStructured)).toMatchObject({
      state: "RUNNING",
      pending: true,
    });
    expect(readConnectorStatus(jobRunningPlain)).toMatchObject({
      pending: true,
      ids: { run_id: 4242, job_id: 17 },
    });
    expect(readConnectorStatus(buildQueued)).toMatchObject({
      pending: true,
      ids: { id: "build-1" },
    });
  });

  it("reports finished states as not pending", () => {
    expect(readConnectorStatus(sqlSucceeded)).toMatchObject({ state: "SUCCEEDED", pending: false });
    expect(readConnectorStatus(sqlFailed)).toMatchObject({ state: "FAILED", pending: false });
    expect(readConnectorStatus(sqlCanceled)).toMatchObject({ state: "CANCELED", pending: false });
    expect(readConnectorStatus(ticketInProgress)?.pending).toBe(false);
  });

  it("reads a hyphenated state as pending", () => {
    expect(readConnectorStatus({ id: "x", status: "in-progress" })?.pending).toBe(true);
  });

  it("ignores everything that is not a structured status", () => {
    for (const value of [
      prosePending,
      rowsWithPending,
      errorPending,
      noIdRunning,
      brokenJson,
      null,
      "PENDING",
      { error: "x", status: "running", id: "1" },
    ])
      expect(readConnectorStatus(value)).toBeUndefined();
  });

  it("does not take an overlong id", () => {
    expect(readConnectorStatus({ id: "x".repeat(201), status: "running" })).toBeUndefined();
  });

  it("stops looking at depth 6", () => {
    const wrap = (levels: number) => {
      let value: Record<string, unknown> = { state: "PENDING" };
      for (let i = 0; i < levels; i++) value = { inner: value };
      return { id: "a", ...value };
    };
    expect(readConnectorStatus(wrap(6))?.pending).toBe(true);
    expect(readConnectorStatus(wrap(7))).toBeUndefined();
  });

  it("prefers a shallower state field", () => {
    expect(readConnectorStatus({ id: "a", status: "done", inner: { state: "PENDING" } })).toEqual({
      state: "DONE",
      pending: false,
      ids: { id: "a" },
    });
  });

  it("is versioned", () => {
    expect(CONNECTOR_STATUS_TABLE.version).toBe(1);
  });
});

describe("findStatusTool", () => {
  const status = readConnectorStatus(sqlPendingText)!;
  const route = { connectorId: "mcp", resourceId: "db-1", toolName: "x" };
  const tool = (over: Partial<ConnectorTool> = {}): ConnectorTool => ({
    name: "get_statement",
    description: "",
    readOnly: true,
    inputSchema: { type: "object", required: ["statement_id"] },
    route,
    ...over,
  });
  const called = tool({ name: "execute_sql_read_only", inputSchema: {} });
  const find = (
    candidates: ConnectorTool[],
    extra: Partial<Parameters<typeof findStatusTool>[0]> = {},
  ) =>
    findStatusTool({
      called,
      calledArgs: { query: "select 1" },
      tools: candidates,
      status,
      disabled: new Set(),
      ...extra,
    });

  it("finds a read tool on the same resource that needs only ids of the result", () => {
    expect(find([called, tool()])?.args).toEqual({ statement_id: "stmt-0001" });
  });

  it("never crosses resources", () => {
    expect(find([tool({ route: { ...route, resourceId: "db-2" } })])).toBeUndefined();
  });

  it("needs a declared read with a read name", () => {
    expect(find([tool({ readOnly: false })])).toBeUndefined();
    expect(find([tool({ readOnly: undefined })])).toBeUndefined();
    expect(find([tool({ name: "cancel_statement" })])).toBeUndefined();
  });

  it("skips disabled, other-id, schemaless and the called tool", () => {
    expect(find([tool()], { disabled: new Set(["get_statement"]) })).toBeUndefined();
    expect(
      find([tool({ inputSchema: { required: ["statement_id", "warehouse_id"] } })]),
    ).toBeUndefined();
    expect(find([tool({ inputSchema: { properties: { statement_id: {} } } })])).toBeUndefined();
    expect(find([called])).toBeUndefined();
  });

  it("skips an id the call itself passed, at any depth", () => {
    expect(find([tool()], { calledArgs: { filter: { ref: "stmt-0001" } } })).toBeUndefined();
  });

  it("returns nothing on a tie and prefers more required keys", () => {
    expect(find([tool(), tool({ name: "get_statement_two" })])).toBeUndefined();
    const job = readConnectorStatus(jobRunningPlain)!;
    const one = tool({ name: "get_status", inputSchema: { required: ["run_id"] } });
    const two = tool({ name: "get_job_status", inputSchema: { required: ["run_id", "job_id"] } });
    expect(find([one, two], { status: job })?.tool.name).toBe("get_job_status");
  });
});
