import { describe, expect, it, vi } from "vitest";
import { alreadyAnsweringRoot } from "./group-root.js";

function db(options: { source?: boolean; root?: boolean; prior?: boolean }) {
  const runFindFirst = vi.fn(async (_args: unknown) => (options.prior ? { id: "run-1" } : null));
  return {
    runFindFirst,
    db: {
      message: {
        findUnique: vi.fn(async () =>
          options.source === false ? null : { seq: 5, threadId: "thread-1" },
        ),
        findFirst: vi.fn(async () => (options.root === false ? null : { seq: 3 })),
      },
      run: { findFirst: runFindFirst },
    } as never,
  };
}

const run = { threadId: "thread-1", sourceMessageId: "message-5" };

describe("alreadyAnsweringRoot", () => {
  it("is true when the target already has a run since the person's message", async () => {
    const { db: prisma, runFindFirst } = db({ prior: true });
    expect(await alreadyAnsweringRoot(prisma, run, "bot-b")).toBe(true);
    expect(runFindFirst.mock.calls[0]?.[0]).toMatchObject({
      where: { botId: "bot-b", sourceMessage: { seq: { gte: 3 } } },
    });
  });

  it("is false when the target has not been woken for it", async () => {
    expect(await alreadyAnsweringRoot(db({}).db, run, "bot-b")).toBe(false);
  });

  it("is false without a source message or a person's message to anchor on", async () => {
    expect(await alreadyAnsweringRoot(db({}).db, { threadId: "thread-1" }, "bot-b")).toBe(false);
    expect(await alreadyAnsweringRoot(db({ source: false }).db, run, "bot-b")).toBe(false);
    expect(await alreadyAnsweringRoot(db({ root: false, prior: true }).db, run, "bot-b")).toBe(
      false,
    );
  });
});
