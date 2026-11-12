import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { TicketChange } from "./ticket-changes.js";
import { announceTicketStep, endTicketRun, startTicketRun } from "./ticket-run-moves.js";

const run = { spaceId: "space-1", botId: "bot-1", ticketId: "ticket-1" };

function setup(
  ticket: { status: string; assigneeBotId?: string | null } = { status: "todo" },
  enabled = true,
) {
  const row = {
    id: "ticket-1",
    spaceId: "space-1",
    number: 4,
    title: "Call the supplier",
    status: ticket.status,
    assigneeBotId: ticket.assigneeBotId === undefined ? "bot-1" : ticket.assigneeBotId,
    boardId: "board-1",
  };
  const comments: Array<{ authorBotId: string; body: string }> = [];
  const tx = {
    ticket: {
      updateMany: vi.fn(
        async (args: {
          where: { id: string; assigneeBotId: string; status: string };
          data: { status: string };
        }) => {
          if (row.status !== args.where.status || row.assigneeBotId !== args.where.assigneeBotId) {
            return { count: 0 };
          }
          row.status = args.data.status;
          return { count: 1 };
        },
      ),
      findUnique: vi.fn(async () => ({ ...row })),
      findFirst: vi.fn(async () => ({ ...row })),
    },
    ticketComment: {
      create: vi.fn(async (args: { data: { authorBotId: string; body: string } }) => {
        comments.push(args.data);
        return args.data;
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    board: {
      findUnique: vi.fn(async () => ({
        id: "board-1",
        ticketPrefix: "RAK",
        statusLabels: { review: "Waiting for you" },
        spaceId: "space-1",
        name: "General",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
    bot: { findUnique: vi.fn(async () => ({ name: "Ana" })) },
  } as unknown as PrismaClient;
  const changes: TicketChange[] = [];
  const deps = {
    prisma,
    ticketBoardEnabled: enabled,
    onTicketChange: async (change: TicketChange) => {
      changes.push(change);
    },
  };
  return { deps, row, comments, changes };
}

describe("a run's own ticket moves", () => {
  it("moves a waiting ticket to In progress when the run starts, as the agent", async () => {
    const { deps, row, changes } = setup({ status: "todo" });
    await startTicketRun(deps, run);
    expect(row.status).toBe("doing");
    expect(changes).toHaveLength(1);
    expect(changes[0]?.moved).toMatchObject({
      ref: "RAK-4",
      status: "doing",
      previousStatus: "todo",
      byBotId: "bot-1",
      byName: "Ana",
    });
    expect(changes[0]?.wakeAssignee).toBe(false);
  });

  it("does nothing a second time", async () => {
    const { deps, changes } = setup({ status: "todo" });
    await startTicketRun(deps, run);
    await startTicketRun(deps, run);
    expect(changes).toHaveLength(1);
  });

  it("never moves a ticket backwards or out of a column it was not in", async () => {
    for (const status of ["doing", "review", "blocked", "done", "closed"]) {
      const { deps, row, changes } = setup({ status });
      await startTicketRun(deps, run);
      expect(row.status).toBe(status);
      expect(changes).toHaveLength(0);
    }
  });

  it("sends a finished run's ticket to review under the board's own column name", async () => {
    const { deps, row, changes, comments } = setup({ status: "doing" });
    await endTicketRun(deps, run, { kind: "finished" });
    expect(row.status).toBe("review");
    expect(changes[0]?.moved).toMatchObject({ status: "review", statusLabel: "Waiting for you" });
    expect(comments).toEqual([]);
  });

  it("blocks a stopped run's ticket and leaves its error as a comment by the agent", async () => {
    const { deps, row, changes, comments } = setup({ status: "doing" });
    await endTicketRun(deps, run, { kind: "stopped", error: "The model key was refused." });
    expect(row.status).toBe("blocked");
    expect(comments).toEqual([
      expect.objectContaining({ authorBotId: "bot-1", body: "The model key was refused." }),
    ]);
    expect(changes[0]?.moved).toMatchObject({ status: "blocked", previousStatus: "doing" });
  });

  it("leaves a ticket a person or the agent already moved, and adds no comment", async () => {
    for (const status of ["todo", "review", "blocked", "done", "closed"]) {
      const finished = setup({ status });
      await endTicketRun(finished.deps, run, { kind: "finished" });
      expect(finished.row.status).toBe(status);
      const stopped = setup({ status });
      await endTicketRun(stopped.deps, run, { kind: "stopped", error: "Failed." });
      expect(stopped.row.status).toBe(status);
      expect(stopped.comments).toEqual([]);
      expect(stopped.changes.filter((change) => change.moved)).toHaveLength(0);
    }
  });

  it("leaves a ticket that now belongs to another agent", async () => {
    const { deps, row } = setup({ status: "doing", assigneeBotId: "bot-2" });
    await endTicketRun(deps, run, { kind: "finished" });
    expect(row.status).toBe("doing");
  });

  it("ends the same way twice", async () => {
    const { deps, comments } = setup({ status: "doing" });
    await endTicketRun(deps, run, { kind: "stopped", error: "Failed." });
    await endTicketRun(deps, run, { kind: "stopped", error: "Failed." });
    expect(comments).toHaveLength(1);
  });

  it("ignores runs with no ticket, and boards that are off", async () => {
    const none = setup({ status: "todo" });
    await startTicketRun(none.deps, { ...run, ticketId: null });
    expect(none.row.status).toBe("todo");
    const off = setup({ status: "todo" }, false);
    await startTicketRun(off.deps, run);
    expect(off.row.status).toBe("todo");
    expect(off.changes).toEqual([]);
  });

  it("clamps a long error to what a comment can hold", async () => {
    const { deps, comments } = setup({ status: "doing" });
    await endTicketRun(deps, run, { kind: "stopped", error: "x".repeat(20_000) });
    expect(comments[0]?.body.length).toBe(10_000);
  });
});

describe("the step shown on the ticket", () => {
  it("announces the latest step in one short line, tied to the agent", async () => {
    const { deps, changes } = setup({ status: "doing" });
    await announceTicketStep(deps, run, "  Searching\nthe   web  ");
    expect(changes[0]).toMatchObject({
      ticketId: "ticket-1",
      boardId: "board-1",
      step: { botId: "bot-1", text: "Searching the web" },
    });
    expect(changes[0]?.moved).toBeUndefined();
  });

  it("truncates a long step", async () => {
    const { deps, changes } = setup({ status: "doing" });
    await announceTicketStep(deps, run, "a".repeat(500));
    expect(changes[0]?.step?.text.length).toBe(120);
  });

  it("clears the step when the run ends, whatever happened to the ticket", async () => {
    const { deps, changes } = setup({ status: "review" });
    await endTicketRun(deps, run, { kind: "finished" });
    expect(changes.at(-1)?.step).toBeNull();
  });

  it("says nothing for a blank step or a run with no ticket", async () => {
    const { deps, changes } = setup({ status: "doing" });
    await announceTicketStep(deps, run, "   ");
    await announceTicketStep(deps, { ...run, ticketId: undefined }, "Working");
    expect(changes).toEqual([]);
  });
});
