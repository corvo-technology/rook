import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { hostActionTools } from "./run-tools-host.js";

vi.mock("./run-progress.js", () => ({
  flushProgress: vi.fn(async () => undefined),
  publishMidTurnNarration: vi.fn(async () => undefined),
}));
vi.mock("@corvo/db", () => ({
  createThreadMessageInTransaction: vi.fn(async () => ({ id: "m-1" })),
  appendEventInTransaction: vi.fn(async () => ({ seq: 7, firstResponse: false })),
}));

const hostContext = {
  actions: [
    {
      name: "book",
      description: "Book a slot",
      params: {
        type: "object",
        properties: { barber: { type: "string", enum: ["rafael", "ana"] } },
        required: ["barber"],
      },
    },
  ],
};

function setup(run: Record<string, unknown>) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    message: { findFirst: vi.fn(async () => null) },
  };
  const deps = {
    prisma: { $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) },
    events: { notify: vi.fn(async () => undefined) },
  };
  const ctx = {
    deps,
    run: { id: "run-1", spaceId: "s", threadId: "t", ...run },
    runId: "run-1",
    bot: { id: "bot-1" },
  } as unknown as RunContext;
  return { ctx, deps };
}

function call(args: Record<string, unknown>) {
  const finish = vi.fn((result: unknown) => result);
  return { call: { args, executionId: "exec-1", finish } as unknown as ToolCall, finish };
}

describe("propose_host_action", () => {
  it("shows a pending card for an action this turn's page registered", async () => {
    const { ctx, deps } = setup({ hostContext });
    const { call: toolCall, finish } = call({ action: "book", params: { barber: "ana" } });
    await hostActionTools.propose_host_action?.(ctx, toolCall);
    const db = await import("@corvo/db");
    expect(vi.mocked(db.createThreadMessageInTransaction).mock.calls[0]?.[1]).toMatchObject({
      blocks: [{ kind: "host_action", name: "book", params: { barber: "ana" }, status: "pending" }],
    });
    expect(deps.events.notify).toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
  });

  it("refuses an action the page never registered, and a run with no page at all", async () => {
    const db = await import("@corvo/db");
    vi.mocked(db.createThreadMessageInTransaction).mockClear();
    for (const run of [{ hostContext }, { hostContext: null }]) {
      const { ctx } = setup(run);
      const { call: toolCall, finish } = call({ action: "refund", params: {} });
      await hostActionTools.propose_host_action?.(ctx, toolCall);
      expect(finish).toHaveBeenCalledWith({ error: expect.any(String) });
    }
    expect(db.createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("refuses params that do not fit the registered schema", async () => {
    const { ctx } = setup({ hostContext });
    const { call: toolCall, finish } = call({ action: "book", params: { barber: "mallory" } });
    await hostActionTools.propose_host_action?.(ctx, toolCall);
    expect(finish).toHaveBeenCalledWith({ error: expect.stringContaining("barber") });
  });
});
