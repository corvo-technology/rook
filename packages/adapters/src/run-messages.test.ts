import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import { publishMessage } from "./run-messages.js";
import { paceBotMessage } from "./run-pacing.js";

const log = vi.hoisted(() => [] as string[]);

vi.mock("@corvo/db", () => ({
  appendEventInTransaction: vi.fn(async () => {
    log.push("event");
    return { seq: 7, firstResponse: false };
  }),
  createThreadMessageInTransaction: vi.fn(async () => {
    log.push("message");
    return { id: "message-1", threadRootId: null };
  }),
  warmThreadContentKey: vi.fn(async () => {
    log.push("warm");
  }),
  withTransactionRetry: <T>(operation: () => Promise<T>) => operation(),
}));

const run = { id: "run-1", spaceId: "s", threadId: "t", botId: "b", trigger: "user" };

function deps() {
  return {
    prisma: {
      $transaction: async (work: (tx: unknown) => unknown) => {
        log.push("tx:open");
        try {
          return await work({});
        } finally {
          log.push("tx:close");
        }
      },
    },
    events: { notify: vi.fn(async () => undefined) },
  } as never;
}

describe("publishMessage", () => {
  it("loads the content key before the transaction opens", async () => {
    log.length = 0;
    await publishMessage(deps(), run, "bot", [{ kind: "text", text: "Hi" }]);
    expect(log).toEqual(["warm", "tx:open", "message", "event", "tx:close"]);
  });

  it("paces a bot message before its transaction, never inside it", async () => {
    log.length = 0;
    const sleep = vi.fn(async () => {
      log.push("sleep");
    });
    const ctx = {
      deps: { pacing: { now: () => 1_000, sleep } },
      abortController: new AbortController(),
      state: { reply: { lastBotMessageAt: 1_000 } },
    } as unknown as RunContext;
    const text = "Second message";
    await paceBotMessage(ctx, text);
    await publishMessage(deps(), run, "bot", [{ kind: "text", text }]);
    expect(log.indexOf("sleep")).toBe(0);
    expect(log.filter((entry) => entry === "sleep")).toHaveLength(1);
  });
});
