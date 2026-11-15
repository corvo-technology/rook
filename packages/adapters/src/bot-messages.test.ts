import type { PrismaClient } from "@corvo/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentBotMessageHop,
  loadBotMessageContext,
  messageBot,
  returnBotMessageOutcome,
  runReturnsOutcome,
} from "./bot-messages.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { updatePlanCard } from "./plan-card.js";

vi.mock("./plan-card.js", () => ({ updatePlanCard: vi.fn(async () => ({ ok: true })) }));

const run = {
  id: "run-1",
  spaceId: "workspace-1",
  threadId: "thread-sender",
  botId: "bot-sender",
  userId: "user-1",
  sourceMessageId: null as string | null,
};
const sender = { id: "bot-sender", name: "Researcher" };

function deps(
  options: {
    bots?: unknown[];
    hopBlocks?: unknown[];
    senderRunning?: boolean;
    alreadyDelivered?: unknown;
    targetArchived?: boolean;
    /** The agent sending, as the audience rule reads it. */
    senderRow?: Record<string, unknown>;
    /** The roles the person behind the run holds. */
    personRoleIds?: string[];
    /** Simulate a unique (threadId, clientNonce) race after both retries miss. */
    uniqueConflictOnCommit?: boolean;
    transactionConflictOnce?: boolean;
  } = {},
) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  const messageFindUnique = vi
    .fn()
    .mockImplementation(async (args: { where?: { threadId_clientNonce?: unknown } }) =>
      args?.where?.threadId_clientNonce
        ? (options.alreadyDelivered ?? null)
        : { blocks: options.hopBlocks ?? [] },
    );
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "thread" }]),
    run: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.senderRunning === false ? null : { id: "run-1" }),
      findUnique: vi.fn().mockResolvedValue({ status: "running" }),
      create: vi.fn().mockResolvedValue({ id: "run-2" }),
    },
    bot: {
      findFirst: vi.fn().mockResolvedValue(options.targetArchived ? null : { id: "bot-target" }),
    },
    task: { create: vi.fn().mockResolvedValue({ id: "task-1" }) },
    message: {
      findUnique: messageFindUnique,
      create: vi.fn().mockResolvedValue({ id: "message-1", seq: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    event: { create: vi.fn().mockResolvedValue({ seq: 7 }) },
    $executeRaw: vi.fn(),
    thread: { update: vi.fn().mockResolvedValue({}) },
  };
  let transactionAttempts = 0;
  const prisma = {
    spaceMember: {
      findUnique: vi.fn(async () => ({
        role: "member",
        roles: (options.personRoleIds ?? []).map((roleId) => ({ roleId })),
      })),
    },
    spaceRole: {
      findMany: vi.fn(async () =>
        (options.personRoleIds ?? []).map((id) => ({
          id,
          spaceId: run.spaceId,
          position: 1,
          keys: [],
          systemKey: null,
        })),
      ),
    },
    bot: {
      findUnique: vi.fn(async () => options.senderRow ?? { userId: "user-1" }),
      findMany: vi
        .fn()
        .mockResolvedValue(
          options.bots ?? [
            { id: "bot-target", name: "Analyst", title: "", thread: { id: "thread-target" } },
          ],
        ),
    },
    message: { findUnique: messageFindUnique, findMany: vi.fn().mockResolvedValue([]) },
    run: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => {
      transactionAttempts += 1;
      if (options.transactionConflictOnce && transactionAttempts === 1) {
        throw Object.assign(new Error("write conflict"), { code: "P2034" });
      }
      if (options.uniqueConflictOnCommit) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      return fn(tx);
    }),
  } as unknown as PrismaClient;
  return {
    deps: { prisma, events: { notify }, jobs: { enqueue } } as unknown as Pick<
      ExecutorDeps,
      "prisma" | "events" | "jobs"
    >,
    tx,
    enqueue,
    notify,
  };
}

describe("messaging another bot", () => {
  beforeEach(() => vi.stubEnv("BOT_MESSAGE_MAX_HOPS", undefined));
  afterEach(() => vi.unstubAllEnvs());

  it("delivers into the target's own chat without marking either thread unread", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "  chart the q3 numbers  ",
    });

    expect(sent).toMatchObject({ ok: true, botId: "bot-target", name: "Analyst" });
    expect(harness.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          botId: "bot-target",
          threadId: "thread-target",
          prompt: expect.stringMatching(/not the user typing[\s\S]*untrusted peer content/),
        }),
      }),
    );
    expect(harness.tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          botId: "bot-target",
          threadId: "thread-target",
          status: "queued",
          trigger: "bot_message",
        }),
      }),
    );
    expect(harness.notify).toHaveBeenCalledWith("thread-target", 7);
    expect(harness.notify).toHaveBeenCalledWith("thread-sender", 7);
    expect(harness.tx.message.create).toHaveBeenCalledTimes(2);
    expect(
      harness.tx.thread.update.mock.calls.filter(
        ([call]) => (call as { data?: { unread?: boolean } }).data?.unread,
      ),
    ).toHaveLength(0);
    expect(harness.enqueue).toHaveBeenCalledTimes(1);
  });

  it("marks a forced failure return unread on both sides", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "research this",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });
    await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      "Could not complete the delegated request.",
      "status",
      { forceUnread: true },
    );

    const unreadWrites = harness.tx.thread.update.mock.calls.filter(
      ([call]) => (call as { data?: { unread?: boolean } }).data?.unread === true,
    );
    expect(unreadWrites).toHaveLength(2);
  });

  it("tells the sender to continue independent work", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "ping",
    });
    expect(sent.ok && sent.note).toContain("async");
    expect(sent.ok && sent.note).toContain("Continue independent work");
  });

  it("refuses a bot messaging itself", async () => {
    const harness = deps({
      bots: [{ id: "bot-sender", name: "Researcher", title: "", thread: { id: "thread-sender" } }],
    });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-sender",
      message: "hello",
    });
    expect(sent).toEqual({ ok: false, error: "a bot cannot message itself" });
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it("refuses an unknown target without starting a run", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-missing",
      message: "hello",
    });
    expect(sent).toEqual({ ok: false, error: "no bot found with that id or name" });
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("refuses an empty message", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "   ",
    });
    expect(sent).toEqual({ ok: false, error: "message is required" });
  });

  it("rejects an oversized message instead of silently truncating it", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "x".repeat(8_001),
    });
    expect(sent).toEqual({ ok: false, error: "message exceeds the 8000 character limit" });
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("does not deliver once the sending run is no longer active", async () => {
    const harness = deps({ senderRunning: false });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "hello",
    });
    expect(sent).toMatchObject({ ok: false });
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it("stops a chain that has volleyed too many times", async () => {
    const harness = deps({
      hopBlocks: [
        { kind: "bot_message_received", fromBotId: "b", fromBotName: "B", text: "hi", hop: 6 },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "again" },
    );
    expect(sent.ok).toBe(false);
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("allows a final result back through after the request hop limit", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Analyst",
          text: "please finish",
          hop: 6,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "finished", intent: "result" },
      { allowTerminalSource: true },
    );
    expect(sent.ok).toBe(true);
    expect(harness.tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(harness.tx.message.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          replyToMessageId: "message-request",
          blocks: expect.arrayContaining([expect.objectContaining({ intent: "result" })]),
        }),
      }),
    );
  });

  it("does not inherit a request reply link when messaging another bot", async () => {
    const harness = deps({
      bots: [
        { id: "bot-target", name: "Analyst", title: "", thread: { id: "thread-target" } },
        { id: "bot-other", name: "Writer", title: "", thread: { id: "thread-other" } },
      ],
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Analyst",
          text: "check Gmail",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });

    await messageBot(harness.deps, { ...run, sourceMessageId: "message-source" }, sender, {
      bot_id: "bot-other",
      message: "unrelated update",
      intent: "fyi",
    });

    expect(harness.tx.message.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ replyToMessageId: undefined }),
      }),
    );
  });

  it("does not inherit a request reply link for an FYI to the requester", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Analyst",
          text: "check Gmail",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });

    await messageBot(harness.deps, { ...run, sourceMessageId: "message-source" }, sender, {
      bot_id: "bot-target",
      message: "unrelated update",
      intent: "fyi",
    });

    expect(harness.tx.message.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ replyToMessageId: undefined }),
      }),
    );
  });

  it("does not exempt a terminal reply to another terminal reply", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Analyst",
          text: "finished",
          hop: 6,
          intent: "result",
        },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "acknowledged", intent: "result" },
      { allowTerminalSource: true },
    );
    expect(sent.ok).toBe(false);
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("does not let a result label bypass the hop limit toward an unrelated bot", async () => {
    const harness = deps({
      bots: [
        { id: "bot-target", name: "Analyst", title: "", thread: { id: "thread-target" } },
        { id: "bot-other", name: "Writer", title: "", thread: { id: "thread-other" } },
      ],
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "please finish",
          hop: 6,
          intent: "request",
        },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-other", message: "keep going", intent: "result" },
    );
    expect(sent.ok).toBe(false);
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("keeps model-supplied status updates subject to the hop limit", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "please finish",
          hop: 6,
          intent: "request",
        },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "still working", intent: "status" },
    );
    expect(sent.ok).toBe(false);
  });

  it("raises the chain limit from BOT_MESSAGE_MAX_HOPS", async () => {
    vi.stubEnv("BOT_MESSAGE_MAX_HOPS", "10");
    const harness = deps({
      hopBlocks: [
        { kind: "bot_message_received", fromBotId: "b", fromBotName: "B", text: "hi", hop: 6 },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "again" },
    );
    expect(sent.ok).toBe(true);
  });

  it("keeps a person-started chain going", async () => {
    const harness = deps({
      hopBlocks: [
        { kind: "bot_message_received", fromBotId: "b", fromBotName: "B", text: "hi", hop: 1 },
      ],
    });
    const sent = await messageBot(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      { bot_id: "bot-target", message: "carry on" },
    );
    expect(sent.ok).toBe(true);
  });
});

describe("hop lookup", () => {
  it("treats a run a person started as the start of a chain", async () => {
    const prisma = { message: { findUnique: vi.fn() } } as unknown as PrismaClient;
    expect(await currentBotMessageHop(prisma, null)).toBe(0);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it("reads the hop back off the message that woke the bot", async () => {
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({
          blocks: [
            { kind: "text", text: "noise" },
            { kind: "bot_message_received", fromBotId: "b", fromBotName: "B", text: "x", hop: 3 },
          ],
        }),
      },
    } as unknown as PrismaClient;
    expect(await currentBotMessageHop(prisma, "message-1")).toBe(3);
  });

  it("requires the linked request to target the agent that sent the wake-up", async () => {
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({
          blocks: [
            {
              kind: "bot_message_received",
              fromBotId: "requester",
              fromBotName: "Requester",
              text: "work on this",
              intent: "result",
              returnToMessageId: "request-message",
            },
          ],
          replyTo: {
            id: "different-message",
            blocks: [
              {
                kind: "bot_message_sent",
                toBotId: "other-agent",
                toBotName: "Other agent",
                text: "work on this",
                intent: "request",
              },
            ],
          },
        }),
      },
    } as unknown as PrismaClient;

    await expect(loadBotMessageContext(prisma, "message-source")).resolves.toMatchObject({
      repliesToRequest: false,
    });
  });

  it.each([
    ["result", true],
    ["status", true],
    ["fyi", true],
    ["request", false],
    ["question", false],
    [undefined, false],
  ])("classifies a linked %s message as a returned answer: %s", async (intent, expected) => {
    const prisma = {
      message: {
        findUnique: vi.fn().mockResolvedValue({
          blocks: [
            {
              kind: "bot_message_received",
              fromBotId: "requester",
              fromBotName: "Requester",
              text: "work on this",
              intent,
              returnToMessageId: "return-echo",
            },
          ],
          replyTo: {
            id: "request-message",
            blocks: [
              {
                kind: "bot_message_sent",
                toBotId: "requester",
                toBotName: "Requester",
                text: "work on this",
                intent: "request",
              },
            ],
          },
        }),
      },
    } as unknown as PrismaClient;

    await expect(loadBotMessageContext(prisma, "message-source")).resolves.toMatchObject({
      repliesToRequest: expected,
    });
  });
});

describe("hardening", () => {
  it("does not deliver twice when the tool call is re-executed", async () => {
    const harness = deps({ alreadyDelivered: { id: "message-1" } });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
      deliveryKey: "call-1",
    });

    expect(sent).toMatchObject({ ok: true, replayed: true, botId: "bot-target" });
    expect(harness.tx.run.create).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it("stamps the delivery so a retry can recognise it", async () => {
    const harness = deps();
    await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
      deliveryKey: "call-1",
    });
    expect(harness.tx.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ clientNonce: "bot-message:call-1" }),
      }),
    );
  });

  it("still delivers when the caller supplies no delivery key", async () => {
    const harness = deps();
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
    });
    expect(sent.ok).toBe(true);
    expect(harness.tx.run.create).toHaveBeenCalled();
  });

  it("does not deliver to a bot archived while the message was being sent", async () => {
    const harness = deps({ targetArchived: true });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
    });
    expect(sent).toMatchObject({ ok: false });
    expect(harness.tx.run.create).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });

  it("treats a delivery-key unique conflict as a replay", async () => {
    const harness = deps({ uniqueConflictOnCommit: true });
    // After both retries miss and the loser hits P2002, the winner is visible.
    (harness.deps.prisma.message.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "message-winner",
    });

    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
      deliveryKey: "call-1",
    });

    expect(sent).toMatchObject({ ok: true, replayed: true, botId: "bot-target" });
    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict without dropping the delivery", async () => {
    const harness = deps({ transactionConflictOnce: true });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
    });
    expect(sent.ok).toBe(true);
    expect(harness.deps.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(harness.enqueue).toHaveBeenCalledOnce();
  });
});

describe("automatic outcome return", () => {
  it("routes a delegated run's final text back to its coordinator", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "research this",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });
    const returned = await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      "The answer is 42.",
    );
    expect(returned).toBe(true);
    expect(harness.tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trigger: "bot_message" }) }),
    );
    expect(harness.tx.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["completed", "failed", "cancelled"] },
        }),
      }),
    );
    expect(harness.enqueue).toHaveBeenCalledOnce();
    expect(harness.deps.prisma.run.updateMany).toHaveBeenCalledWith({
      where: {
        id: run.id,
        status: { in: ["completed", "failed", "cancelled"] },
        botOutcomeReturnedAt: null,
      },
      data: { botOutcomeReturnedAt: expect.any(Date) },
    });
  });

  it("still returns a final result after an interim status update", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "research this",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });
    vi.mocked(harness.deps.prisma.message.findMany).mockResolvedValue([
      {
        blocks: [
          {
            kind: "bot_message_sent",
            toBotId: "bot-target",
            toBotName: "Coordinator",
            text: "still looking",
            hop: 2,
            intent: "status",
          },
        ],
      },
    ] as never);

    const returned = await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      "The answer is 42.",
    );

    expect(returned).toBe(true);
    expect(harness.enqueue).toHaveBeenCalledOnce();
  });

  it("skips the automatic return when a result was already sent", async () => {
    const harness = deps({
      hopBlocks: [
        {
          kind: "bot_message_received",
          fromBotId: "bot-target",
          fromBotName: "Coordinator",
          text: "research this",
          hop: 1,
          intent: "request",
          returnToMessageId: "message-request",
        },
      ],
    });
    vi.mocked(harness.deps.prisma.message.findMany).mockResolvedValue([
      {
        blocks: [
          {
            kind: "bot_message_sent",
            toBotId: "bot-target",
            toBotName: "Coordinator",
            text: "done",
            hop: 2,
            intent: "result",
          },
        ],
      },
    ] as never);

    const returned = await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-source" },
      sender,
      "The answer is 42.",
    );

    expect(returned).toBe(true);
    expect(harness.enqueue).not.toHaveBeenCalled();
    expect(harness.deps.prisma.run.updateMany).toHaveBeenCalled();
  });
});

describe("a stage handed off by a router outside the group", () => {
  const routed = {
    kind: "handoff",
    fromBotId: "bot-target",
    toBotId: "bot-sender",
    text: "write five bios",
    hop: 1,
    returnsToSender: true,
  };

  it("returns the stage's result to the router that sent it, like a delegated request", async () => {
    const harness = deps({ hopBlocks: [routed] });
    const returned = await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-handoff" },
      sender,
      "Here are five bios.",
    );
    expect(returned).toBe(true);
    expect(harness.tx.run.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trigger: "bot_message", botId: "bot-target" }),
      }),
    );
    expect(harness.enqueue).toHaveBeenCalledOnce();
  });

  it("tells the router it may route the next stage only when it routed with the owner's authority", async () => {
    const withAuthority = deps({ hopBlocks: [{ ...routed, routedWithAuthority: true }] });
    await returnBotMessageOutcome(
      withAuthority.deps,
      { ...run, sourceMessageId: "message-handoff" },
      sender,
      "Here are five bios.",
    );
    expect(
      withAuthority.tx.message.create.mock.calls.some(([args]) =>
        JSON.stringify((args as { data: { blocks: unknown } }).data.blocks).includes(
          '"continuesRouting":true',
        ),
      ),
    ).toBe(true);

    const withoutAuthority = deps({ hopBlocks: [routed] });
    await returnBotMessageOutcome(
      withoutAuthority.deps,
      { ...run, sourceMessageId: "message-handoff" },
      sender,
      "Here are five bios.",
    );
    expect(
      withoutAuthority.tx.message.create.mock.calls.some(([args]) =>
        JSON.stringify((args as { data: { blocks: unknown } }).data.blocks).includes(
          "continuesRouting",
        ),
      ),
    ).toBe(false);
  });

  it("returns nothing for a handoff between group members, which passes the baton", async () => {
    const { returnsToSender: _omitted, ...transfer } = routed;
    const harness = deps({ hopBlocks: [transfer] });
    const returned = await returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-handoff" },
      sender,
      "Here are five bios.",
    );
    expect(returned).toBe(true);
    expect(harness.tx.run.create).not.toHaveBeenCalled();
    expect(harness.enqueue).not.toHaveBeenCalled();
  });
});

describe("runReturnsOutcome", () => {
  const prismaReading = (blocks: unknown[] | Error) =>
    ({
      message: {
        findUnique: vi.fn(async () => {
          if (blocks instanceof Error) throw blocks;
          return { blocks };
        }),
      },
    }) as unknown as PrismaClient;
  const handoff = { kind: "handoff", fromBotId: "bot-a", toBotId: "bot-b", text: "x" };

  it("is true for a delegated run and for a routed handoff, and false for the rest", async () => {
    const none = prismaReading([]);
    expect(await runReturnsOutcome(none, { trigger: "bot_message" })).toBe(true);
    expect(
      await runReturnsOutcome(prismaReading([{ ...handoff, returnsToSender: true }]), {
        trigger: "follow_up",
        sourceMessageId: "m",
      }),
    ).toBe(true);
    expect(
      await runReturnsOutcome(prismaReading([handoff]), {
        trigger: "follow_up",
        sourceMessageId: "m",
      }),
    ).toBe(false);
    expect(await runReturnsOutcome(none, { trigger: "user", sourceMessageId: "m" })).toBe(false);
  });

  it("does not look anything up for a run that cannot return", async () => {
    const prisma = prismaReading([]);
    await runReturnsOutcome(prisma, { trigger: "user", sourceMessageId: "m" });
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
  });

  it("is false, not an error, when the source cannot be read", async () => {
    const failing = prismaReading(new Error("down"));
    expect(await runReturnsOutcome(failing, { trigger: "follow_up", sourceMessageId: "m" })).toBe(
      false,
    );
  });
});

describe("the plan step a stage carries", () => {
  const routedWithStep = {
    kind: "handoff",
    fromBotId: "bot-target",
    toBotId: "bot-sender",
    text: "write five bios",
    hop: 1,
    returnsToSender: true,
    planStep: "2",
  };
  const withThread = (harness: ReturnType<typeof deps>) => {
    (harness.deps.prisma as unknown as { thread: unknown }).thread = {
      findUnique: vi.fn(async () => ({ id: "thread-router", spaceId: "workspace-1" })),
    };
    return harness;
  };
  const finish = (
    harness: ReturnType<typeof deps>,
    intent: "result" | "status",
    failed?: boolean,
  ) =>
    returnBotMessageOutcome(
      harness.deps,
      { ...run, sourceMessageId: "message-handoff" },
      sender,
      "text",
      intent,
      failed === undefined ? undefined : { failed },
    );

  beforeEach(() => vi.mocked(updatePlanCard).mockClear());

  it("marks the step done on the sender's plan when the answer comes back", async () => {
    const harness = withThread(deps({ hopBlocks: [routedWithStep] }));
    await finish(harness, "result");
    expect(updatePlanCard).toHaveBeenCalledWith(
      harness.deps,
      { spaceId: "workspace-1", threadId: "thread-router", botId: "bot-target" },
      { updates: [{ step: "2", status: "done" }] },
    );
  });

  it("marks it failed when the stage failed, and leaves it alone for a progress note", async () => {
    const failed = withThread(deps({ hopBlocks: [routedWithStep] }));
    await finish(failed, "status", true);
    expect(updatePlanCard).toHaveBeenCalledWith(failed.deps, expect.anything(), {
      updates: [{ step: "2", status: "failed" }],
    });
    vi.mocked(updatePlanCard).mockClear();
    const progress = withThread(deps({ hopBlocks: [routedWithStep] }));
    await finish(progress, "status");
    expect(updatePlanCard).not.toHaveBeenCalled();
  });

  it("touches no plan when the stage carried no step, and a plan failure never fails the return", async () => {
    const noStep = withThread(deps({ hopBlocks: [{ ...routedWithStep, planStep: undefined }] }));
    await finish(noStep, "result");
    expect(updatePlanCard).not.toHaveBeenCalled();
    vi.mocked(updatePlanCard).mockRejectedValueOnce(new Error("down"));
    const throwing = withThread(deps({ hopBlocks: [routedWithStep] }));
    expect(await finish(throwing, "result")).toBe(true);
  });

  it("carries the step in the request a direct message sends", async () => {
    const harness = deps();
    await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "chart it",
      planStep: " 3 ",
    });
    expect(
      harness.tx.message.create.mock.calls.some(([args]) =>
        JSON.stringify((args as { data: { blocks: unknown } }).data.blocks).includes(
          '"planStep":"3"',
        ),
      ),
    ).toBe(true);
  });
});

describe("an agent asking for a person", () => {
  const closed = (patch: Record<string, unknown> = {}) => ({
    id: "bot-target",
    name: "Analyst",
    title: "",
    thread: { id: "thread-target" },
    userId: "owner-1",
    audienceRestricted: true,
    audienceRoleIds: ["sales"],
    audienceUserIds: [],
    consultable: true,
    ...patch,
  });

  it("reaches a consultable agent for someone outside its audience", async () => {
    const harness = deps({ bots: [closed()] });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "what is the quota?",
    });
    expect(sent).toMatchObject({ ok: true });
    expect(harness.tx.run.create).toHaveBeenCalled();
  });

  it("is refused when the agent takes no consultations", async () => {
    const harness = deps({ bots: [closed({ consultable: false })] });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "what is the quota?",
    });
    expect(sent).toMatchObject({
      ok: false,
      error: expect.stringContaining("works only with some people"),
    });
    expect(harness.tx.run.create).not.toHaveBeenCalled();
  });

  it("reaches it either way for someone in its audience", async () => {
    const harness = deps({
      bots: [closed({ consultable: false })],
      personRoleIds: ["sales"],
    });
    const sent = await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "what is the quota?",
    });
    expect(sent).toMatchObject({ ok: true });
  });

  it("gives the answer only to the asking agent when the person is outside the answerer's audience", async () => {
    // The answerer (the sender here) is closed to this person; the asking agent is open.
    const harness = deps({
      senderRow: {
        userId: "owner-2",
        audienceRestricted: true,
        audienceRoleIds: ["finance"],
        audienceUserIds: [],
        consultable: true,
      },
    });
    await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "the quota is 40 units",
      intent: "result",
    });
    const created = harness.tx.message.create.mock.calls.map(
      (call) => (call[0] as { data: { blocks: Array<Record<string, unknown>> } }).data.blocks[0],
    );
    const received = created.find((block) => block?.kind === "bot_message_received");
    expect(received).toMatchObject({ text: "", consultation: true });
    // The agent itself still gets the answer in the prompt that wakes it.
    expect(harness.tx.task.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ prompt: expect.stringContaining("the quota is 40 units") }),
      }),
    );
  });

  it("keeps the answer in the transcript when the person is in the answerer's audience", async () => {
    const harness = deps({
      senderRow: {
        userId: "owner-2",
        audienceRestricted: true,
        audienceRoleIds: ["finance"],
        audienceUserIds: [],
        consultable: true,
      },
      personRoleIds: ["finance"],
    });
    await messageBot(harness.deps, run, sender, {
      bot_id: "bot-target",
      message: "the quota is 40 units",
      intent: "result",
    });
    const created = harness.tx.message.create.mock.calls.map(
      (call) => (call[0] as { data: { blocks: Array<Record<string, unknown>> } }).data.blocks[0],
    );
    expect(created.find((block) => block?.kind === "bot_message_received")).toMatchObject({
      text: "the quota is 40 units",
    });
  });
});
