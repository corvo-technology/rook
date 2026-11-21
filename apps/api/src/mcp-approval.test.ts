import type * as db from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import {
  coveredAgents,
  dismissMcpServerApprovals,
  queueMcpConnectedRun,
  resolveMcpApprovalCards,
  revertConnectedMcpApprovals,
} from "./mcp-approval.js";

vi.mock("@corvo/db", async (original) => ({
  ...(await original<typeof db>()),
  appendEventInTransaction: vi.fn(async () => ({ seq: 1 })),
}));

/** PostgreSQL jsonb `@>` containment, which Prisma `array_contains` compiles to. */
function jsonContains(value: unknown, needle: unknown): boolean {
  if (Array.isArray(needle)) {
    return (
      Array.isArray(value) &&
      needle.every((item) => value.some((candidate) => jsonContains(candidate, item)))
    );
  }
  if (needle !== null && typeof needle === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.entries(needle).every(([key, item]) => jsonContains(record[key], item));
  }
  return value === needle;
}

function fixture(blocks: unknown[]) {
  const tx = {
    message: {
      findMany: vi.fn(async () => [{ id: "card-message", botId: "bot", blocks }]),
      update: vi.fn(),
    },
  };
  const deps = {
    prisma: {
      bot: { findFirst: vi.fn(async () => ({ id: "bot", thread: { id: "main-thread" } })) },
      thread: { findMany: vi.fn(async () => [{ id: "group-thread" }]) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    },
    events: { notify: vi.fn() },
  } as unknown as Parameters<typeof resolveMcpApprovalCards>[0];
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@corvo.test",
    isDeploymentOwner: true,
  };
  return { deps, actor, tx };
}

describe("resolveMcpApprovalCards", () => {
  it("flips pending and pre-upgrade cards for the matching server", async () => {
    const blocks = [
      { kind: "text", text: "before" },
      { kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" },
      { kind: "mcp_approval", name: "Legacy", serverId: "srv-a" },
      { kind: "mcp_approval", name: "B", serverId: "srv-b", status: "pending" },
      { kind: "mcp_approval", name: "C", serverId: "srv-a", status: "dismissed" },
    ];
    const { deps, actor, tx } = fixture(blocks);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "connected",
      threadId: "group-thread",
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: {
        blocks: [
          blocks[0],
          { ...blocks[1], status: "connected" },
          { ...blocks[2], status: "connected" },
          blocks[3],
          blocks[4],
        ],
      },
    });
  });

  it("scans the requested chat when a threadId is given", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "dismissed",
      threadId: "group-thread",
    });
    expect(deps.prisma.thread.findMany).toHaveBeenCalledWith({
      where: {
        id: "group-thread",
        spaceId: "space",
        userId: "user",
        OR: [
          { botId: "bot" },
          { group: { members: { some: { botId: "bot" } } } },
          {
            messages: {
              some: {
                blocks: {
                  array_contains: [{ kind: "mcp_approval", serverId: "srv-a", forBotId: "bot" }],
                },
              },
            },
          },
        ],
      },
      select: { id: true, botId: true },
    });
    expect(tx.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: "group-thread" } }),
    );
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...blocks[0], status: "dismissed" }] },
    });
  });

  it("falls back to owner scope for chats the bot was removed from", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    deps.prisma.thread.findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "group-thread" }]);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "connected",
      threadId: "group-thread",
    });
    expect(deps.prisma.thread.findMany).toHaveBeenCalledTimes(2);
    expect(deps.prisma.thread.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "group-thread",
        spaceId: "space",
        userId: "user",
        groupId: { not: null },
      },
      select: { id: true, botId: true },
    });
    expect(deps.prisma.bot.findFirst).toHaveBeenCalled();
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...blocks[0], status: "connected" }] },
    });
  });

  it("leaves untouched messages alone when nothing matches", async () => {
    const blocks = [{ kind: "mcp_approval", name: "B", serverId: "srv-b", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "connected",
    });
    expect(tx.message.update).not.toHaveBeenCalled();
  });

  it("writes the assignment in the same transaction when a card connects", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    const effect = vi.fn(async () => "saved");
    await expect(
      resolveMcpApprovalCards(
        deps,
        actor,
        { botId: "bot", serverId: "srv-a", status: "connected" },
        effect,
      ),
    ).resolves.toBe("saved");
    expect(effect).toHaveBeenCalledWith(tx, { assign: true, resolved: true });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...blocks[0], status: "connected" }] },
    });
  });

  it("does not assign when a dismissed card already won", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "dismissed" }];
    const { deps, actor, tx } = fixture(blocks);
    const effect = vi.fn(async () => "saved");
    await resolveMcpApprovalCards(
      deps,
      actor,
      { botId: "bot", serverId: "srv-a", status: "connected", threadId: "group-thread" },
      effect,
    );
    expect(effect).toHaveBeenCalledWith(tx, { assign: false, resolved: false });
    expect(tx.message.update).not.toHaveBeenCalled();
  });

  it("still assigns from settings after a card was dismissed", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "dismissed" }];
    const { deps, actor, tx } = fixture(blocks);
    const effect = vi.fn(async () => "saved");
    await expect(
      resolveMcpApprovalCards(
        deps,
        actor,
        { botId: "bot", serverId: "srv-a", status: "connected" },
        effect,
      ),
    ).resolves.toBe("saved");
    expect(effect).toHaveBeenCalledWith(tx, { assign: true, resolved: true });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...blocks[0], status: "connected" }] },
    });
  });

  it("returns a connected card to pending when the assignment is removed", async () => {
    const blocks = [
      { kind: "mcp_approval", name: "A", serverId: "srv-a", status: "connected" },
      { kind: "mcp_approval", name: "B", serverId: "srv-b", status: "connected" },
      { kind: "mcp_approval", name: "C", serverId: "srv-a", status: "dismissed" },
    ];
    const { deps, actor, tx } = fixture(blocks);
    await revertConnectedMcpApprovals(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "pending",
    });
    expect(deps.prisma.thread.findMany).toHaveBeenCalledWith({
      where: {
        spaceId: "space",
        userId: "user",
        OR: [
          { botId: "bot" },
          { groupId: { not: null }, messages: { some: { botId: "bot" } } },
          {
            messages: {
              some: { blocks: { array_contains: [{ kind: "mcp_approval", forBotId: "bot" }] } },
            },
          },
        ],
      },
      select: { id: true, botId: true },
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: {
        blocks: [{ ...blocks[0], status: "pending" }, blocks[1], blocks[2]],
      },
    });
  });

  it("dismisses connected and pending cards when the server is deleted", async () => {
    const blocks = [
      { kind: "mcp_approval", name: "A", serverId: "srv-a", status: "connected" },
      { kind: "mcp_approval", name: "Open", serverId: "srv-a", status: "pending" },
      { kind: "mcp_approval", name: "C", serverId: "srv-a", status: "dismissed" },
    ];
    const rows = [
      {
        id: "card-message",
        botId: null,
        threadId: "group-thread",
        thread: { botId: "bot" },
        blocks,
      },
      {
        id: "mention",
        botId: "bot",
        threadId: "group-thread",
        thread: { botId: "bot" },
        blocks: [{ kind: "text", text: "server srv-a is gone" }],
      },
      {
        id: "other-server",
        botId: "bot",
        threadId: "group-thread",
        thread: { botId: "bot" },
        blocks: [{ kind: "mcp_approval", name: "B", serverId: "srv-b", status: "connected" }],
      },
    ];
    const { deps, actor, tx } = fixture(blocks);
    tx.message.findMany = vi.fn(
      async (query: { where?: { blocks?: { array_contains?: unknown } } }) => {
        const needle = query.where?.blocks?.array_contains;
        if (needle === undefined) return [];
        return rows.filter((row) => jsonContains(row.blocks, needle));
      },
    );
    await dismissMcpServerApprovals(deps, actor, "srv-a");
    expect(deps.prisma.thread.findMany).not.toHaveBeenCalled();
    expect(tx.message.findMany).toHaveBeenCalledWith({
      where: {
        thread: { spaceId: "space", userId: "user" },
        blocks: { array_contains: [{ kind: "mcp_approval", serverId: "srv-a" }] },
      },
      select: {
        id: true,
        botId: true,
        blocks: true,
        threadId: true,
        thread: { select: { botId: true } },
      },
    });
    expect(tx.message.update).toHaveBeenCalledTimes(1);
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: {
        blocks: [
          { ...blocks[0], status: "dismissed" },
          { ...blocks[1], status: "dismissed" },
          blocks[2],
        ],
      },
    });
  });

  it("does not reset another bot's card in a shared group", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "connected" }];
    const { deps, actor, tx } = fixture(blocks);
    tx.message.findMany = vi.fn(async () => [{ id: "card-message", botId: "other-bot", blocks }]);
    await revertConnectedMcpApprovals(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "pending",
    });
    expect(tx.message.update).not.toHaveBeenCalled();
  });

  it("does not repaint another bot's direct chat when the bot has left", async () => {
    const blocks = [{ kind: "mcp_approval", name: "A", serverId: "srv-a", status: "pending" }];
    const { deps, actor, tx } = fixture(blocks);
    deps.prisma.thread.findMany = vi.fn(async () => []);
    deps.prisma.bot.findFirst = vi.fn(async () => null);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "bot",
      serverId: "srv-a",
      status: "dismissed",
      threadId: "other-thread",
    });
    expect(tx.message.update).not.toHaveBeenCalled();
  });
});

describe("a card shown in an agent's chat that is for a teammate", () => {
  const card = {
    kind: "mcp_approval",
    name: "Sentry",
    serverId: "srv-a",
    status: "pending",
    forBotId: "infra",
    forBotName: "Infra",
  };

  function chiefFixture(blocks: unknown[]) {
    const f = fixture(blocks);
    // The card is the chief's own message in the chief's chat.
    f.tx.message.findMany = vi.fn(async () => [{ id: "card-message", botId: "chief", blocks }]);
    f.deps.prisma.thread.findMany = vi.fn(async () => [{ id: "chief-thread", botId: "chief" }]);
    return f;
  }

  it("is decided for the teammate, even though the chief wrote it", async () => {
    const { deps, actor, tx } = chiefFixture([card]);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "infra",
      serverId: "srv-a",
      status: "connected",
      threadId: "chief-thread",
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...card, status: "connected" }] },
    });
  });

  it("is not decided for the chief, who only asked", async () => {
    const { deps, actor, tx } = chiefFixture([card]);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "chief",
      serverId: "srv-a",
      status: "connected",
      threadId: "chief-thread",
    });
    expect(tx.message.update).not.toHaveBeenCalled();
  });

  it("goes back to pending when the teammate's assignment is removed", async () => {
    const { deps, actor, tx } = chiefFixture([{ ...card, status: "connected" }]);
    await revertConnectedMcpApprovals(deps, actor, {
      botId: "infra",
      serverId: "srv-a",
      status: "pending",
    });
    expect(tx.message.update).toHaveBeenCalledWith({
      where: { id: "card-message" },
      data: { blocks: [{ ...card, status: "pending" }] },
    });
    // The asking agent's chat is found through the card that names the teammate.
    expect(deps.prisma.thread.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          {
            messages: {
              some: { blocks: { array_contains: [{ kind: "mcp_approval", forBotId: "infra" }] } },
            },
          },
        ]),
      }),
      select: { id: true, botId: true },
    });
  });

  it("leaves a card for another teammate of the same server alone", async () => {
    const { deps, actor, tx } = chiefFixture([{ ...card, forBotId: "marketing" }]);
    await resolveMcpApprovalCards(deps, actor, {
      botId: "infra",
      serverId: "srv-a",
      status: "connected",
      threadId: "chief-thread",
    });
    expect(tx.message.update).not.toHaveBeenCalled();
  });
});

describe("queueMcpConnectedRun", () => {
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@corvo.test",
    isDeploymentOwner: true,
  };
  const input = { botId: "bot", serverId: "srv-a", threadId: "thread" };

  function connectedFixture(state: { thread?: boolean; busy?: boolean; archived?: boolean } = {}) {
    const tx = {
      bot: { findFirst: vi.fn(async () => (state.archived ? null : { id: "bot" })) },
      thread: { findFirst: vi.fn(async () => (state.thread === false ? null : { id: "thread" })) },
      run: {
        findFirst: vi.fn(async () => (state.busy ? { id: "active" } : null)),
        create: vi.fn(async () => ({ id: "run" })),
      },
      mcpServer: { findFirst: vi.fn(async () => ({ name: "Axiom" })) },
      task: { create: vi.fn(async () => ({ id: "task" })) },
    };
    return tx as typeof tx & Parameters<typeof queueMcpConnectedRun>[0];
  }

  it("queues a turn for the bot in the card's chat", async () => {
    const tx = connectedFixture();
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBe("run");
    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: "bot",
        threadId: "thread",
        prompt: expect.stringContaining('"Axiom"'),
      }),
    });
    expect(tx.run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ taskId: "task", trigger: "user", status: "queued" }),
      select: { id: true },
    });
  });

  it("does not queue while the bot is still busy in that chat", async () => {
    const tx = connectedFixture({ busy: true });
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBeNull();
    expect(tx.run.create).not.toHaveBeenCalled();
  });

  it("does not restart an archived bot", async () => {
    const tx = connectedFixture({ archived: true });
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBeNull();
    expect(tx.bot.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "bot", archivedAt: null }),
      select: { id: true },
    });
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it("does not queue in a chat the bot is not part of", async () => {
    const tx = connectedFixture({ thread: false });
    await expect(queueMcpConnectedRun(tx, actor, input)).resolves.toBeNull();
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  describe("for a card that is for a teammate", () => {
    function teammateFixture(state: { card?: boolean; busy?: boolean } = {}) {
      const tx = {
        bot: {
          findFirst: vi.fn(async (args: { where: { id: string } }) =>
            args.where.id === "infra" ? { id: "infra", name: "Infra" } : { id: args.where.id },
          ),
        },
        thread: {
          // The first look finds the thread only through the bot that is in it; the asking
          // agent's chat is found through the card that names the teammate.
          findFirst: vi.fn(async (args: { where: { botId?: unknown; OR?: unknown } }) =>
            args.where.OR ? null : state.card === false ? null : { id: "thread", botId: "chief" },
          ),
        },
        run: {
          findFirst: vi.fn(async () => (state.busy ? { id: "active" } : null)),
          create: vi.fn(async () => ({ id: "run" })),
        },
        mcpServer: { findFirst: vi.fn(async () => ({ name: "Sentry" })) },
        task: { create: vi.fn(async () => ({ id: "task" })) },
      };
      return tx as typeof tx & Parameters<typeof queueMcpConnectedRun>[0];
    }
    const forInfra = { botId: "infra", serverId: "srv-a", threadId: "thread" };

    it("wakes the agent that asked, and names the teammate", async () => {
      const tx = teammateFixture();
      await expect(queueMcpConnectedRun(tx, actor, forInfra)).resolves.toBe("run");
      expect(tx.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          botId: "chief",
          threadId: "thread",
          prompt: expect.stringContaining("Infra"),
        }),
      });
      expect(tx.run.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ botId: "chief", taskId: "task" }),
        select: { id: true },
      });
      // Only a chat that holds a card for this teammate and server is found.
      expect(tx.thread.findFirst).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          id: "thread",
          messages: {
            some: {
              blocks: {
                array_contains: [{ kind: "mcp_approval", serverId: "srv-a", forBotId: "infra" }],
              },
            },
          },
        }),
        select: { id: true, botId: true },
      });
    });

    it("does nothing in a chat that holds no card for the teammate", async () => {
      const tx = teammateFixture({ card: false });
      await expect(queueMcpConnectedRun(tx, actor, forInfra)).resolves.toBeNull();
      expect(tx.task.create).not.toHaveBeenCalled();
    });

    it("does not wake the agent that asked while it is still busy in that chat", async () => {
      const tx = teammateFixture({ busy: true });
      await expect(queueMcpConnectedRun(tx, actor, forInfra)).resolves.toBeNull();
      expect(tx.run.create).not.toHaveBeenCalled();
    });
  });
});

describe("a card for several agents", () => {
  const actor = {
    userId: "user",
    spaceId: "space",
    email: "user@corvo.test",
    isDeploymentOwner: true,
  };
  const card = {
    kind: "mcp_approval",
    serverId: "srv-a",
    forBotId: "lia",
    forBots: [
      { id: "lia", name: "Lia", allowedTools: ["list_appointments"], level: "write" },
      { id: "caio", name: "Caio", level: "read" },
    ],
  };
  function fixture(bots = ["lia", "caio"]) {
    const tx = {
      message: { findMany: vi.fn(async () => [{ blocks: [card] }]) },
      bot: {
        findMany: vi.fn(async () =>
          bots.map((id) => ({ id, name: id === "lia" ? "Lia" : "Caio" })),
        ),
      },
    };
    return tx as typeof tx & Parameters<typeof coveredAgents>[0];
  }

  it("covers each agent the card names with that agent's own tools", async () => {
    const covered = await coveredAgents(fixture(), actor, {
      botId: "lia",
      botIds: ["lia", "caio"],
      serverId: "srv-a",
      threadId: "thread",
    });
    expect(covered).toEqual([
      { id: "lia", name: "Lia", allowedTools: ["list_appointments"], level: "write" },
      { id: "caio", name: "Caio", level: "read" },
    ]);
  });

  it("refuses an agent the card does not name", async () => {
    await expect(
      coveredAgents(fixture(["lia", "mallory"]), actor, {
        botId: "lia",
        botIds: ["mallory"],
        serverId: "srv-a",
        threadId: "thread",
      }),
    ).rejects.toThrow();
  });

  it("wakes the lead once for all of them and names every agent", async () => {
    const tx = {
      bot: {
        findFirst: vi.fn(async (args: { where: { id: string } }) => ({
          id: args.where.id,
          name: "Lia",
        })),
      },
      thread: {
        findFirst: vi.fn(async (args: { where: { OR?: unknown } }) =>
          args.where.OR ? null : { id: "thread", botId: "chief" },
        ),
      },
      run: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "run" })) },
      mcpServer: { findFirst: vi.fn(async () => ({ name: "Clinic" })) },
      task: { create: vi.fn(async () => ({ id: "task" })) },
    } as unknown as Parameters<typeof queueMcpConnectedRun>[0];
    await expect(
      queueMcpConnectedRun(tx, actor, {
        botId: "lia",
        serverId: "srv-a",
        threadId: "thread",
        teammateNames: ["Lia", "Caio"],
      }),
    ).resolves.toBe("run");
    const prompt = (tx.task.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].data.prompt;
    expect(prompt).toContain("Lia, Caio");
    expect(prompt).toContain("Carry on with what they asked for");
  });
});
