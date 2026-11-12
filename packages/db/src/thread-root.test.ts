import { describe, expect, it, vi } from "vitest";
import { createThreadMessageInTransaction, threadRootOfSource } from "./messages.js";

describe("threadRootOfSource", () => {
  it("is the thread a message was posted in", () => {
    expect(threadRootOfSource({ id: "m2", threadRootId: "m1", blocks: [] })).toBe("m1");
  });

  it("is the hand-off itself when it opens the work", () => {
    expect(
      threadRootOfSource({ id: "h1", threadRootId: null, blocks: [{ kind: "handoff" }] }),
    ).toBe("h1");
  });

  it("is a hand-off's thread, not a new one, when the hand-off was made inside a thread", () => {
    expect(
      threadRootOfSource({ id: "h2", threadRootId: "h1", blocks: [{ kind: "handoff" }] }),
    ).toBe("h1");
  });

  it("is nothing for an ordinary message in the main column", () => {
    expect(
      threadRootOfSource({ id: "m1", threadRootId: null, blocks: [{ kind: "text", text: "hi" }] }),
    ).toBeUndefined();
    expect(threadRootOfSource(null)).toBeUndefined();
  });
});

describe("a run's messages", () => {
  function tx(source: unknown) {
    return {
      thread: { update: vi.fn().mockResolvedValue({ nextMessageSeq: 5 }) },
      run: {
        findUnique: vi.fn().mockResolvedValue({
          status: "running",
          startedAt: null,
          firstResponseAt: null,
          userId: "u",
          sourceMessage: source,
        }),
      },
      message: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
    };
  }
  const blocks = [{ kind: "text" as const, text: "done" }];

  it("land in the thread the run was started in", async () => {
    const client = tx({ id: "h1", threadRootId: null, blocks: [{ kind: "handoff" }] });
    await createThreadMessageInTransaction(client as never, {
      threadId: "t",
      role: "bot",
      blocks,
      runId: "run-1",
    });
    expect(client.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadRootId: "h1" }),
    });
  });

  it("stay in the main column when the run was started there", async () => {
    const client = tx({ id: "m1", threadRootId: null, blocks: blocks });
    await createThreadMessageInTransaction(client as never, {
      threadId: "t",
      role: "bot",
      blocks,
      runId: "run-1",
    });
    expect(client.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadRootId: undefined }),
    });
  });

  it("go where a person put them when they name a thread", async () => {
    const client = tx(null);
    await createThreadMessageInTransaction(client as never, {
      threadId: "t",
      role: "user",
      blocks,
      threadRootId: "m1",
    });
    expect(client.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ threadRootId: "m1" }),
    });
  });
});
