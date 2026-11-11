/** Invented connector result shapes with placeholder ids. */
const text = (value: unknown) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

export const sqlPendingText = text({ statement_id: "stmt-0001", status: { state: "PENDING" } });

export const sqlRunningStructured = {
  structuredContent: { statement_id: "stmt-0001", status: { state: "RUNNING" } },
};

export const sqlSucceeded = {
  structuredContent: {
    statement_id: "stmt-0001",
    status: { state: "SUCCEEDED" },
    result: { rows: [[1]] },
  },
};

export const sqlFailed = {
  structuredContent: {
    statement_id: "stmt-0001",
    status: { state: "FAILED" },
    error_message: "syntax error",
  },
};

export const sqlCanceled = {
  structuredContent: { statement_id: "stmt-0001", status: { state: "CANCELED" } },
};

export const jobRunningPlain = { run_id: 4242, job_id: 17, state: { life_cycle_state: "RUNNING" } };

export const buildQueued = { id: "build-1", status: "queued" };

export const ticketInProgress = { id: "T-1", status: "In Progress" };

export const prosePending = text("The statement is still pending, statement_id stmt-0001");

export const rowsWithPending = { rows: [{ id: "a", status: "pending" }] };

export const errorPending = { ...sqlPendingText, isError: true };

export const noIdRunning = { status: "running" };

export const brokenJson = text("{ not json");
