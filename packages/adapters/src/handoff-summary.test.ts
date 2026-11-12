import { beforeEach, describe, expect, it, vi } from "vitest";

const createThreadMessageInTransaction = vi.hoisted(() => vi.fn());
const appendEventInTransaction = vi.hoisted(() => vi.fn());
vi.mock("@corvo/db", () => ({
  createThreadMessageInTransaction,
  appendEventInTransaction,
  withTransactionRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { closeHandoffGroup } from "./handoff-summary.js";

const handoff = (id: string, toBotId: string, text: string) => ({
  id,
  blocks: [{ kind: "handoff", fromBotId: "chief", toBotId, text }],
});

function setup(
  overrides: {
    runs?: Array<{ sourceMessageId: string; status: string; error?: string | null }>;
    posted?: boolean;
    handoffs?: ReturnType<typeof handoff>[];
  } = {},
) {
  const handoffs = overrides.handoffs ?? [
    handoff("h-1", "bento", "Draft the post."),
    handoff("h-2", "cora", "Pull the numbers."),
  ];
  const runs = overrides.runs ?? [
    { sourceMessageId: "h-1", status: "completed" },
    { sourceMessageId: "h-2", status: "completed" },
  ];
  const tx = {};
  const prisma = {
    message: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        "id" in where
          ? { id: "h-2", threadId: "thread", runId: "chief-run", blocks: handoffs[1]!.blocks }
          : overrides.posted
            ? { id: "summary" }
            : null,
      ),
      findMany: vi.fn(async ({ where }: { where: { runId?: string; threadRootId?: string } }) =>
        where.runId
          ? handoffs
          : [{ blocks: [{ kind: "text", text: `Done: ${where.threadRootId}` }] }],
      ),
    },
    run: {
      findMany: vi.fn(async () =>
        runs.map((run) => ({ error: null, botId: "x", id: "r", ...run })),
      ),
    },
    bot: {
      findFirst: vi.fn(async () => ({
        id: "chief",
        spaceId: "space",
        userId: "user",
        modelProvider: null,
        modelId: null,
      })),
      findMany: vi.fn(async () => [
        { id: "bento", name: "Bento" },
        { id: "cora", name: "Cora" },
      ]),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  };
  const events = { notify: vi.fn(async () => undefined) };
  const handoffSummary = vi.fn(
    async (_call: { prompt: string }): Promise<string | undefined> => "Both pieces are ready.",
  );
  const close = () =>
    closeHandoffGroup({ prisma, events, handoffSummary } as never, {
      id: "run-2",
      sourceMessageId: "h-2",
    });
  return { prisma, events, handoffSummary, close };
}

beforeEach(() => {
  vi.clearAllMocks();
  createThreadMessageInTransaction.mockResolvedValue({ id: "summary" });
  appendEventInTransaction.mockResolvedValue({ seq: 9 });
});

describe("the Chief's closing summary", () => {
  it("is posted once in the main column when every handed-off run has finished", async () => {
    const { close, handoffSummary, events } = setup();
    await close();
    expect(handoffSummary).toHaveBeenCalledTimes(1);
    const prompt = handoffSummary.mock.calls[0]![0].prompt;
    expect(prompt).toContain("Bento");
    expect(prompt).toContain("Done: h-1");
    expect(createThreadMessageInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: "thread",
        botId: "chief",
        clientNonce: "handoff-summary:chief-run",
        blocks: [{ kind: "text", text: "Both pieces are ready." }],
      }),
    );
    expect(events.notify).toHaveBeenCalledWith("thread", 9);
  });

  it("does not carry a thread root, so it lands in the main column", async () => {
    await setup().close();
    expect(createThreadMessageInTransaction.mock.calls[0]![1]).not.toHaveProperty("threadRootId");
  });

  it("waits while any handed-off run is still going", async () => {
    const { close, handoffSummary } = setup({
      runs: [
        { sourceMessageId: "h-1", status: "completed" },
        { sourceMessageId: "h-2", status: "waiting_input" },
      ],
    });
    await close();
    expect(handoffSummary).not.toHaveBeenCalled();
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("reports a failed run's reason to the model", async () => {
    const { close, handoffSummary } = setup({
      runs: [
        { sourceMessageId: "h-1", status: "completed" },
        { sourceMessageId: "h-2", status: "failed", error: "No access to the calendar" },
      ],
    });
    await close();
    expect(handoffSummary.mock.calls[0]![0].prompt).toContain("No access to the calendar");
  });

  it("is skipped when it was already posted", async () => {
    const { close, handoffSummary } = setup({ posted: true });
    await close();
    expect(handoffSummary).not.toHaveBeenCalled();
  });

  it("is skipped for a single hand-off", async () => {
    const { close, handoffSummary } = setup({ handoffs: [handoff("h-1", "bento", "Draft.")] });
    await close();
    expect(handoffSummary).not.toHaveBeenCalled();
  });

  it("is skipped without a model", async () => {
    const { prisma, events } = setup();
    await closeHandoffGroup({ prisma, events } as never, { id: "run-2", sourceMessageId: "h-2" });
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("posts nothing when the model returns nothing", async () => {
    const { close, handoffSummary } = setup();
    handoffSummary.mockResolvedValueOnce(undefined);
    await close();
    expect(createThreadMessageInTransaction).not.toHaveBeenCalled();
  });

  it("never throws when the model fails", async () => {
    const { close, handoffSummary } = setup();
    handoffSummary.mockRejectedValueOnce(new Error("timeout"));
    await expect(close()).resolves.toBeUndefined();
  });

  it("treats a concurrent duplicate post as done", async () => {
    const { close } = setup();
    createThreadMessageInTransaction.mockRejectedValueOnce({ code: "P2002" });
    await expect(close()).resolves.toBeUndefined();
  });
});
