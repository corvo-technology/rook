import { describe, expect, it, vi } from "vitest";
import {
  rowsWithPending,
  sqlFailed,
  sqlPendingText,
  sqlSucceeded,
} from "./connector-status.fixtures.js";
import { readConnectorStatus } from "./connector-status.js";
import {
  abortableSleep,
  awaitConnectorResult,
  CONNECTOR_WAIT_LIMITS,
  type ConnectorWaitLimits,
  type ConnectorWaitOutcome,
  connectorWaitNote,
} from "./connector-wait.js";

const args = { statement_id: "stmt-0001" };
const firstStatus = readConnectorStatus(sqlPendingText)!;

function run(
  poll: (n: number, t: number) => { result: unknown } | { error: string },
  over: {
    limits?: Partial<ConnectorWaitLimits>;
    controller?: AbortController;
    active?: () => boolean;
    onFirstPause?: () => Promise<void>;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const clock = { t: 0 };
  let n = 0;
  const controller = over.controller ?? new AbortController();
  const outcome = awaitConnectorResult(
    sqlPendingText,
    firstStatus,
    args,
    async () => poll(++n, clock.t),
    {
      limits: { ...CONNECTOR_WAIT_LIMITS, ...over.limits },
      sleep:
        over.sleep ??
        (async (ms) => {
          clock.t += ms;
        }),
      now: () => clock.t,
      signal: controller.signal,
      active: over.active ?? (() => true),
      onFirstPause: over.onFirstPause,
    },
  );
  return outcome;
}

const pending = { result: sqlPendingText };

describe("awaitConnectorResult", () => {
  it("polls with doubling pauses until the result is done", async () => {
    const times: number[] = [];
    const outcome = await run((_n, t) => {
      times.push(t);
      return t >= 30_000 ? { result: sqlSucceeded } : pending;
    });
    expect(outcome).toMatchObject({ kind: "done", polls: 5, result: sqlSucceeded });
    expect(times).toEqual([2_000, 6_000, 14_000, 29_000, 44_000]);
  });

  it("returns the last pending result when the cap is reached", async () => {
    const outcome = await run(() => pending, { limits: { maxWaitMs: 60_000 } });
    expect(outcome).toMatchObject({ kind: "time", ms: 60_000, polls: 7 });
    expect(
      (outcome as Extract<ConnectorWaitOutcome, { kind: "time" | "status_error" }>).status.state,
    ).toBe("PENDING");
  });

  it("ends at once on a failed state or an error result", async () => {
    expect(await run(() => ({ result: sqlFailed }))).toMatchObject({ kind: "done", polls: 1 });
    expect(await run(() => ({ result: { isError: true, content: [] } }))).toMatchObject({
      kind: "done",
      polls: 1,
    });
  });

  it("ends on a status call that errors", async () => {
    expect(await run(() => ({ error: "boom" }))).toMatchObject({
      kind: "status_error",
      error: "boom",
    });
  });

  it("ends when the answer is not a status for the same ids", async () => {
    const rows = await run(() => ({ result: rowsWithPending }));
    expect(rows.kind).toBe("not_status");
    expect(rows.result).toBe(sqlPendingText);
    const other = await run(() => ({
      result: { statement_id: "stmt-9999", status: { state: "PENDING" } },
    }));
    expect(other.kind).toBe("not_status");
  });

  it("stops when the signal aborts or the lease is lost", async () => {
    const controller = new AbortController();
    const aborted = await run(() => pending, {
      controller,
      sleep: async () => controller.abort(),
    });
    expect(aborted).toMatchObject({ kind: "stopped", polls: 0 });
    let polled = 0;
    const lost = await run(
      () => {
        polled++;
        return pending;
      },
      { active: () => polled < 1 },
    );
    expect(lost).toMatchObject({ kind: "stopped", polls: 1 });
  });

  it("announces the first pause once", async () => {
    const onFirstPause = vi.fn(async () => {});
    await run(() => pending, { limits: { maxWaitMs: 60_000 }, onFirstPause });
    expect(onFirstPause).toHaveBeenCalledTimes(1);
  });
});

describe("abortableSleep", () => {
  it("resolves without waiting when already aborted", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      controller.abort();
      await abortableSleep(10_000, controller.signal);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("notes", () => {
  it("tells the model how long the backend waited", () => {
    const note = connectorWaitNote(
      { kind: "time", result: sqlPendingText, status: firstStatus, polls: 23, ms: 300_000 },
      "get_statement",
      args,
    );
    expect(note).toContain("Still PENDING after waiting 5 min (23 checks with get_statement)");
    expect(note).toContain("statement_id=stmt-0001");
  });
});
