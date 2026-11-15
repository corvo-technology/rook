import { HANDOFF_REASON_MAX_LENGTH } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { handoffToGroupBot, loadBotGroupDirectory } from "./group-handoff.js";

const MEMBER_ONLY = { squadRouting: false, ownerStarted: true };

const run = {
  id: "run-a",
  spaceId: "workspace-1",
  threadId: "thread-1",
  botId: "bot-a",
  userId: "user-1",
};

function harness(
  sourceBlocks: unknown,
  existing?: { id?: string; sourceRuns: { id: string; botId: string }[] },
) {
  const runCreate = vi.fn(async () => ({ id: "run-b" }));
  const messageCreate = vi.fn(async (_args: unknown) => ({ id: "message-1" }));
  const tx = {
    $queryRaw: vi.fn(async (..._args: unknown[]) => [{ id: "group-1" }]),
    $executeRaw: vi.fn(),
    chatGroup: {
      findFirst: vi.fn(async () => ({
        id: "group-1",
        name: "Project",
        thread: { id: run.threadId },
        members: ["bot-a", "bot-b", "bot-c"].map((id) => ({
          bot: { id, name: id.toUpperCase() },
        })),
      })),
      update: vi.fn(async () => ({ id: "group-1" })),
    },
    run: {
      findFirst: vi.fn(async () => ({
        id: run.id,
        trigger: "user",
        thread: { groupId: "group-1" as string | null },
        sourceMessage: { blocks: sourceBlocks, role: "user" },
      })),
      findUnique: vi.fn(async () => ({ status: "running" })),
      create: runCreate,
    },
    message: {
      findUnique: vi.fn(async (_args: unknown) => existing ?? null),
      create: messageCreate,
    },
    thread: {
      update: vi.fn(async (args: { select: { nextMessageSeq?: boolean } }) =>
        args.select.nextMessageSeq ? { nextMessageSeq: 2 } : { nextEventSeq: 2 },
      ),
    },
    task: { create: vi.fn(async (_args: unknown) => ({ id: "task-b" })) },
    spaceMember: { findUnique: vi.fn(async () => ({ role: "member", roles: [] })) },
    spaceRole: { findMany: vi.fn(async () => []) },
    bot: {
      // Agents of the space outside the group, and the audience columns of any target.
      findMany: vi.fn(async (_args: unknown) => [] as { id: string; name: string }[]),
      findFirst: vi.fn(async (_args: unknown) => ({
        userId: "owner",
        audienceRestricted: false,
        audienceRoleIds: [] as string[],
        audienceUserIds: [] as string[],
        consultable: true,
      })),
    },
    event: {
      findFirst: vi.fn(async () => ({ seq: 1 })),
      create: vi.fn(async () => ({ seq: 1 })),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return {
    deps: {
      prisma,
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    },
    messageCreate,
    runCreate,
    tx,
  };
}

describe("group handoff ownership", () => {
  it("marks a new ownership transfer as a follow-up with a chain hop", async () => {
    const { deps, messageCreate, runCreate } = harness([{ kind: "text", text: "user request" }]);

    await expect(
      handoffToGroupBot(
        deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Do the distinct next stage",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b" });

    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [
            expect.objectContaining({
              kind: "handoff",
              fromBotId: "bot-a",
              toBotId: "bot-b",
              hop: 1,
            }),
          ],
        }),
      }),
    );
    // A handoff inside the group passes the baton: nothing comes back to the sender.
    expect(messageCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { blocks: [expect.not.objectContaining({ returnsToSender: true })] },
    });
    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trigger: "follow_up" }) }),
    );
  });

  it("refuses to bounce a handed-off stage straight back to its sender", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Investigate", hop: 1 },
    ]);

    await expect(
      handoffToGroupBot(
        deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "You investigate it",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toEqual({
      error:
        "do not hand this stage back to its sender; post the result in the shared thread instead",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("caps longer multi-agent handoff chains", async () => {
    const { deps, runCreate } = harness([
      { kind: "handoff", fromBotId: "bot-b", toBotId: "bot-a", text: "Stage six", hop: 6 },
    ]);

    await expect(
      handoffToGroupBot(
        deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-c",
          message: "Stage seven",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toEqual({
      error:
        "group handoff limit reached for this chain; finish the current stage in the shared thread instead",
    });
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("reuses the recorded transfer when a source run is retried", async () => {
    const { deps, messageCreate, runCreate } = harness([], {
      sourceRuns: [{ id: "run-b", botId: "bot-b" }],
    });

    await expect(
      handoffToGroupBot(
        deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-c",
          message: "A duplicate stage",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ ok: true, botId: "bot-b", runId: "run-b" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed source ancestry instead of restarting its hop count", async () => {
    const { deps, runCreate } = harness({ kind: "not-an-array" });

    await expect(
      handoffToGroupBot(
        deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toEqual({ error: "cannot verify the group handoff chain" });
    expect(runCreate).not.toHaveBeenCalled();
  });
});

describe("explicit group destinations", () => {
  function privateTurn() {
    const h = harness([{ kind: "text", text: "Private request" }]);
    h.tx.chatGroup.findFirst.mockResolvedValue({
      id: "group-1",
      name: "Project",
      thread: { id: "group-thread" },
      members: ["bot-a", "bot-b"].map((id) => ({ bot: { id, name: id } })),
    });
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "user",
      thread: { groupId: null },
      sourceMessage: { blocks: [{ kind: "text", text: "Private request" }], role: "user" },
    });
    return h;
  }

  it("posts only the supplied task in the selected group and queues its next stage there", async () => {
    const h = privateTurn();
    const result = await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      {
        bot_id: "bot-b",
        message: "  Review the public plan  ",
      },
      MEMBER_ONLY,
    );
    expect(result).toMatchObject({ ok: true, groupId: "group-1" });
    expect(h.messageCreate).toHaveBeenCalledTimes(1);
    expect(h.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "group-thread",
          runId: undefined,
          blocks: [
            {
              kind: "handoff",
              fromBotId: "bot-a",
              toBotId: "bot-b",
              text: "Review the public plan",
              hop: 1,
              // Sent from the bot's private chat, so the result comes back there.
              returnsToSender: true,
            },
          ],
        }),
      }),
    );
    expect(h.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "group-thread",
          botId: "bot-b",
          trigger: "follow_up",
          sourceMessageId: "message-1",
        }),
      }),
    );
    expect(h.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "group-thread",
          prompt: "Review the public plan",
        }),
      }),
    );
    expect(h.tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          threadId: "group-thread",
          runId: undefined,
          type: "group.handoff",
        }),
      }),
    );
    expect(h.deps.events.notify).toHaveBeenCalledWith("group-thread", 1);
    expect(h.deps.jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("cannot redirect an existing group's stage to another group", async () => {
    const h = privateTurn();
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "user",
      thread: { groupId: "other-group" },
      sourceMessage: { blocks: [], role: "user" },
    });
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ error: "group handoffs must stay in the current group" });
    expect(h.messageCreate).not.toHaveBeenCalled();
  });

  it.each(["bot_message", "routine", "webhook", "follow_up"])(
    "lets a bot coordinate in its group from a %s run",
    async (trigger) => {
      const h = privateTurn();
      h.tx.run.findFirst.mockResolvedValue({
        id: run.id,
        trigger,
        thread: { groupId: null },
        sourceMessage: { blocks: [], role: "bot" },
      });
      await expect(
        handoffToGroupBot(
          h.deps as never,
          run,
          "group-1",
          {
            bot_id: "bot-b",
            message: "Continue",
          },
          MEMBER_ONLY,
        ),
      ).resolves.toMatchObject({ ok: true });
      expect(h.runCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ threadId: "group-thread", trigger: "follow_up" }),
        }),
      );
    },
  );

  it("keeps the chain limit when a direct conversation continues in a group", async () => {
    const h = privateTurn();
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "bot_message",
      thread: { groupId: null },
      sourceMessage: {
        role: "user",
        blocks: [
          {
            kind: "bot_message_received",
            fromBotId: "bot-c",
            fromBotName: "Planner",
            text: "Continue",
            hop: 6,
          },
        ],
      },
    });
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toHaveProperty("error");
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("delivers distinct calls to the same group and replays only the matching call", async () => {
    const h = privateTurn();
    h.runCreate.mockResolvedValueOnce({ id: "run-b" }).mockResolvedValueOnce({ id: "run-c" });
    const nonceOf = (args: unknown) => (args as { data: { clientNonce: string } }).data.clientNonce;
    h.tx.message.findUnique.mockImplementation(async (args: unknown) => {
      const nonce = (args as { where: { threadId_clientNonce: { clientNonce: string } } }).where
        .threadId_clientNonce.clientNonce;
      const index = h.messageCreate.mock.calls.findIndex(([call]) => nonceOf(call) === nonce);
      return index < 0
        ? null
        : {
            id: "message-1",
            sourceRuns: [{ id: index === 0 ? "run-b" : "run-c", botId: "bot-b" }],
          };
    });
    const send = (message: string, deliveryKey: string) =>
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message,
          deliveryKey,
        },
        MEMBER_ONLY,
      );
    await expect(send("Review the plan", "effect-1")).resolves.toMatchObject({
      ok: true,
      runId: "run-b",
    });
    await expect(send("Check the sources", "effect-2")).resolves.toMatchObject({
      ok: true,
      runId: "run-c",
    });
    await expect(send("Review the plan", "effect-1")).resolves.toMatchObject({
      ok: true,
      runId: "run-b",
    });
    expect(h.runCreate).toHaveBeenCalledTimes(2);
    expect(h.messageCreate).toHaveBeenCalledTimes(2);
    expect(h.messageCreate.mock.calls.map(([args]) => nonceOf(args))).toEqual([
      "group-handoff:effect-1",
      "group-handoff:effect-2",
    ]);
    expect(
      h.tx.task.create.mock.calls.map(
        ([args]) => (args as { data: { prompt: string } }).data.prompt,
      ),
    ).toEqual(["Review the plan", "Check the sources"]);
  });

  it("does not start group work after the source run stops", async () => {
    const h = privateTurn();
    h.tx.run.findFirst.mockResolvedValue(null as never);
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ error: "source run is no longer active" });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("replays an explicit destination without creating another message or run", async () => {
    const h = privateTurn();
    h.tx.message.findUnique.mockResolvedValue({
      id: "message-1",
      sourceRuns: [{ id: "run-b", botId: "bot-b" }],
    });
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ ok: true, runId: "run-b" });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.runCreate).not.toHaveBeenCalled();
    expect(h.deps.events.notify).toHaveBeenCalledWith("group-thread", 1);
  });

  it("rejects unavailable, unowned, or cross-space groups", async () => {
    const h = privateTurn();
    h.tx.$queryRaw.mockResolvedValue([]);
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        {
          bot_id: "bot-b",
          message: "Continue",
        },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ error: "group is no longer available" });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual(["group-1", run.spaceId]);
  });

  it("requires both bots to be active members of the destination", async () => {
    for (const memberIds of [["bot-b"], ["bot-a"]]) {
      const h = privateTurn();
      h.tx.chatGroup.findFirst.mockResolvedValue({
        id: "group-1",
        name: "Project",
        thread: { id: "group-thread" },
        members: memberIds.map((id) => ({ bot: { id, name: id } })),
      });
      await expect(
        handoffToGroupBot(
          h.deps as never,
          run,
          "group-1",
          {
            bot_id: "bot-b",
            message: "Continue",
          },
          MEMBER_ONLY,
        ),
      ).resolves.toHaveProperty("error");
      expect(h.runCreate).not.toHaveBeenCalled();
    }
  });

  it.each([
    { label: "empty", message: "" },
    { label: "blank", message: " " },
    { label: "oversized", message: "x".repeat(8001) },
  ])("rejects $label tasks", async ({ message }) => {
    const h = privateTurn();
    await expect(
      handoffToGroupBot(h.deps as never, run, "group-1", { bot_id: "bot-b", message }, MEMBER_ONLY),
    ).resolves.toHaveProperty("error");
    expect(h.runCreate).not.toHaveBeenCalled();
  });
});

describe("directory for a squad-routing bot", () => {
  const row = {
    id: "group-1",
    name: "Product",
    purpose: "Analisa concorrentes",
    members: [{ bot: { id: "bot-b", name: "Research" } }],
  };

  it("lists the owner's groups in this space even when the bot is not a member, never archived ones", async () => {
    const findMany = vi.fn(async () => [row]);
    const text = await loadBotGroupDirectory(
      { chatGroup: { findMany } } as unknown as PrismaClient,
      run,
      { allGroups: true },
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId: run.spaceId,
          archivedAt: null,
          members: { some: { bot: { archivedAt: null } } },
          thread: { isNot: null },
        },
        select: expect.objectContaining({ purpose: true }),
      }),
    );
    expect(text).toContain("[purpose: Analisa concorrentes]");
    expect(text).toContain("ask_user");
  });

  it("keeps the member-only view and no guidance without the option", async () => {
    const findMany = vi.fn(async () => [row]);
    const text = await loadBotGroupDirectory(
      { chatGroup: { findMany } } as unknown as PrismaClient,
      run,
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          members: { some: { botId: run.botId, bot: { archivedAt: null } } },
        }),
      }),
    );
    expect(text).not.toContain("ask_user");
  });
});

it("discovers only active groups the bot belongs to in the same space", async () => {
  const findMany = vi.fn(async () => []);
  await expect(
    loadBotGroupDirectory({ chatGroup: { findMany } } as unknown as PrismaClient, run),
  ).resolves.toBeUndefined();
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        spaceId: run.spaceId,
        archivedAt: null,
        members: { some: { botId: run.botId, bot: { archivedAt: null } } },
        thread: { isNot: null },
      },
    }),
  );
});

describe("squad routing authority", () => {
  const routing = { squadRouting: true, ownerStarted: true };

  /** A private turn of bot-a, which is not a member of the destination group. */
  function outsideTurn(over: { archived?: boolean } = {}) {
    const h = harness([{ kind: "text", text: "Analisem a landing" }]);
    h.tx.chatGroup.findFirst.mockResolvedValue(
      (over.archived
        ? null
        : {
            id: "group-1",
            name: "Product",
            thread: { id: "group-thread" },
            members: ["bot-b", "bot-c"].map((id) => ({ bot: { id, name: id } })),
          }) as never,
    );
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "user",
      thread: { groupId: null },
      sourceMessage: { blocks: [{ kind: "text", text: "Analisem a landing" }], role: "user" },
    });
    return h;
  }

  it("a bot without squadRouting cannot hand off to a group it is not in", async () => {
    const h = outsideTurn();
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go" },
        {
          squadRouting: false,
          ownerStarted: true,
        },
      ),
    ).resolves.toMatchObject({ error: "source bot is no longer a group member" });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("marks a handoff made with squad authority, so its answer may route on, and not one made without", async () => {
    const routerTurn = outsideTurn();
    await handoffToGroupBot(
      routerTurn.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Avaliar o hero" },
      routing,
    );
    expect(routerTurn.messageCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { blocks: [expect.objectContaining({ routedWithAuthority: true })] },
    });
    // The same sender as a member of the group, in its private chat: no squad authority.
    const memberTurn = outsideTurn();
    memberTurn.tx.chatGroup.findFirst.mockResolvedValue({
      id: "group-1",
      name: "Project",
      thread: { id: "group-thread" },
      members: ["bot-a", "bot-b"].map((id) => ({ bot: { id, name: id } })),
    } as never);
    await handoffToGroupBot(
      memberTurn.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Review it" },
      MEMBER_ONLY,
    );
    expect(memberTurn.messageCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { blocks: [expect.not.objectContaining({ routedWithAuthority: true })] },
    });
  });

  it("carries the plan step the stage belongs to", async () => {
    const h = outsideTurn();
    await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Avaliar o hero", planStep: " 2 " },
      routing,
    );
    expect(h.messageCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { blocks: [expect.objectContaining({ planStep: "2" })] },
    });
  });

  it("a handoff from outside the group expects the stage's result back", async () => {
    const h = outsideTurn();
    await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Avaliar o hero" },
      routing,
    );
    expect(h.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [expect.objectContaining({ kind: "handoff", returnsToSender: true })],
        }),
      }),
    );
  });

  it("a squadRouting bot in an owner-started run hands off into a group it is not in", async () => {
    const h = outsideTurn();
    const result = await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Avaliar o hero" },
      routing,
    );
    expect(result).toMatchObject({ ok: true, botId: "bot-b", groupId: "group-1" });
    expect(h.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ threadId: "group-thread", botId: "bot-b" }),
      }),
    );
    expect(h.tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ threadId: "group-thread", type: "group.handoff" }),
      }),
    );
  });

  it("a squadRouting bot in a run the owner did not start is refused", async () => {
    const h = outsideTurn();
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go" },
        {
          squadRouting: true,
          ownerStarted: false,
        },
      ),
    ).resolves.toHaveProperty("error");
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("looks the group up in the run's own space, whoever created it, and ignores archived ones", async () => {
    const gone = outsideTurn({ archived: true });
    await expect(
      handoffToGroupBot(
        gone.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go" },
        routing,
      ),
    ).resolves.toMatchObject({ error: "group is no longer available" });
    expect(gone.runCreate).not.toHaveBeenCalled();
    const h = outsideTurn();
    await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Go" },
      routing,
    );
    expect(h.tx.$queryRaw.mock.calls[0]?.slice(1)).toEqual(["group-1", run.spaceId]);
    expect(h.tx.chatGroup.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "group-1",
          spaceId: run.spaceId,
          archivedAt: null,
        }),
        include: expect.objectContaining({
          members: expect.objectContaining({ where: { bot: { archivedAt: null } } }),
        }),
      }),
    );
  });

  it("a squadRouting bot inside a group still cannot hand off to a different group", async () => {
    const h = outsideTurn();
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "user",
      thread: { groupId: "group-elsewhere" },
      sourceMessage: { blocks: [{ kind: "text", text: "x" }], role: "user" },
    });
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go" },
        routing,
      ),
    ).resolves.toMatchObject({ error: "group handoffs must stay in the current group" });
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("only hands off to a member of the group", async () => {
    const h = outsideTurn();
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { bot_id: "bot-z", message: "Go" },
        routing,
      ),
    ).resolves.toMatchObject({ error: "handoff target is not an agent of this space" });
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("stores the reason on the block and the event, and refuses one that is too long", async () => {
    const h = outsideTurn();
    await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Avaliar o hero", reason: "  Envolve analisar uma landing  " },
      routing,
    );
    expect(h.messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blocks: [
            expect.objectContaining({ kind: "handoff", reason: "Envolve analisar uma landing" }),
          ],
        }),
      }),
    );
    expect(h.tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ reason: "Envolve analisar uma landing" }),
        }),
      }),
    );
    const long = outsideTurn();
    await expect(
      handoffToGroupBot(
        long.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go", reason: "x".repeat(HANDOFF_REASON_MAX_LENGTH + 1) },
        routing,
      ),
    ).resolves.toHaveProperty("error");
    expect(long.runCreate).not.toHaveBeenCalled();
  });

  it("replays a retried handoff without a second message or task", async () => {
    const h = harness([{ kind: "text", text: "Analisem a landing" }], {
      id: "message-1",
      sourceRuns: [{ id: "run-b", botId: "bot-b" }],
    });
    h.tx.chatGroup.findFirst.mockResolvedValue({
      id: "group-1",
      name: "Product",
      thread: { id: "group-thread" },
      members: ["bot-b", "bot-c"].map((id) => ({ bot: { id, name: id } })),
    } as never);
    h.tx.run.findFirst.mockResolvedValue({
      id: run.id,
      trigger: "user",
      thread: { groupId: null },
      sourceMessage: { blocks: [], role: "user" },
    });
    const result = await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { bot_id: "bot-b", message: "Go", deliveryKey: "call-1" },
      routing,
    );
    expect(result).toMatchObject({ ok: true, botId: "bot-b" });
    expect(h.messageCreate).not.toHaveBeenCalled();
    expect(h.tx.task.create).not.toHaveBeenCalled();
  });
});

describe("handing a stage to an agent outside the channel", () => {
  const closed = {
    userId: "owner",
    audienceRestricted: true,
    audienceRoleIds: [] as string[],
    audienceUserIds: [] as string[],
    consultable: true,
  };

  it("starts that agent in the channel as a guest", async () => {
    const h = harness([{ kind: "text", text: "preciso do CTO" }]);
    h.tx.bot.findMany.mockResolvedValue([{ id: "cto", name: "CTO" }]);
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { confirm_name: "CTO", message: "Audite o preço" },
        MEMBER_ONLY,
      ),
    ).resolves.toMatchObject({ ok: true, botId: "cto" });
    expect(h.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ botId: "cto", threadId: run.threadId }),
      }),
    );
  });

  it("refuses an agent that works only with some people, pointing to a private ask", async () => {
    const h = harness([{ kind: "text", text: "preciso do CTO" }]);
    h.tx.bot.findMany.mockResolvedValue([{ id: "cto", name: "CTO" }]);
    h.tx.bot.findFirst.mockResolvedValue(closed);
    const result = await handoffToGroupBot(
      h.deps as never,
      run,
      "group-1",
      { confirm_name: "CTO", message: "Audite o preço" },
      MEMBER_ONLY,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("message_bot") });
    expect(h.runCreate).not.toHaveBeenCalled();
  });

  it("keeps a restricted member behind the same rule", async () => {
    const h = harness([{ kind: "text", text: "go" }]);
    h.tx.bot.findFirst.mockResolvedValue(closed);
    await expect(
      handoffToGroupBot(
        h.deps as never,
        run,
        "group-1",
        { bot_id: "bot-b", message: "Go" },
        MEMBER_ONLY,
      ),
    ).resolves.toHaveProperty("error");
    expect(h.runCreate).not.toHaveBeenCalled();
  });
});
