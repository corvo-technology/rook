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
import { CONNECTOR_STATUS_TABLE, readConnectorStatus } from "./connector-status.js";

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
