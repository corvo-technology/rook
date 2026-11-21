import { describe, expect, it, vi } from "vitest";

const createTicket = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({ ticket: { ref: "RAK-1" } })),
);
vi.mock("./ticket-tools.js", () => ({ createTicket }));

import { ticketUnfinishedDelegation } from "./delegated-work.js";

const GOAL = "Finish collecting 1,000 barbershops for the SDR team.";

function world(options: { blocks?: unknown[]; openTicket?: boolean } = {}) {
  const blocks = options.blocks ?? [
    {
      kind: "handoff",
      fromBotId: "chief",
      toBotId: "rafa",
      text: GOAL,
      returnsToSender: true,
    },
  ];
  return {
    prisma: {
      message: { findUnique: vi.fn(async () => ({ blocks, replyTo: null })) },
      ticket: {
        findFirst: vi.fn(async () => (options.openTicket ? { id: "t1" } : null)),
      },
    },
    ticketBoardEnabled: true,
  } as never;
}

const run = {
  id: "r1",
  spaceId: "s",
  botId: "rafa",
  userId: "u",
  trigger: "follow_up",
  sourceMessageId: "m1",
};

describe("ticketUnfinishedDelegation", () => {
  it("turns work the agent says is left into a ticket the delegating bot creates", async () => {
    createTicket.mockClear();
    const made = await ticketUnfinishedDelegation(world(), run, {
      remaining: "21 ready, 979 pending",
      cut: false,
    });
    expect(made).toBe(true);
    const input = createTicket.mock.calls[0]![1] as Record<string, string>;
    expect(input).toMatchObject({
      botId: "chief",
      ownerBotId: "rafa",
      spaceId: "s",
      userId: "u",
    });
    expect(input.acceptanceCriteria).toContain(GOAL);
    expect(input.acceptanceCriteria).toContain("979 pending");
  });

  it("does the same for a bot message request cut short by a run guard", async () => {
    createTicket.mockClear();
    const blocks = [
      {
        kind: "bot_message_received",
        fromBotId: "chief",
        fromBotName: "Chief",
        text: GOAL,
        hop: 1,
        intent: "request",
      },
    ];
    const made = await ticketUnfinishedDelegation(
      world({ blocks }),
      { ...run, trigger: "bot_message" },
      { cut: true },
    );
    expect(made).toBe(true);
    expect(createTicket).toHaveBeenCalledOnce();
  });

  it("creates nothing when the work is done", async () => {
    createTicket.mockClear();
    expect(await ticketUnfinishedDelegation(world(), run, { cut: false })).toBe(false);
    expect(createTicket).not.toHaveBeenCalled();
  });

  it("creates nothing for a ticket run, an owner's follow-up or when a ticket is already open", async () => {
    createTicket.mockClear();
    const left = { remaining: "half left", cut: false };
    expect(await ticketUnfinishedDelegation(world(), { ...run, ticketId: "t0" }, left)).toBe(false);
    const ownerBlocks = [{ kind: "text", text: "continue" }];
    expect(await ticketUnfinishedDelegation(world({ blocks: ownerBlocks }), run, left)).toBe(false);
    expect(await ticketUnfinishedDelegation(world({ openTicket: true }), run, left)).toBe(false);
    expect(createTicket).not.toHaveBeenCalled();
  });
});
