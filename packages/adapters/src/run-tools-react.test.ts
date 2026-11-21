import { describe, expect, it, vi } from "vitest";

const published = vi.hoisted(() => [] as unknown[][]);
vi.mock("./run-messages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-messages.js")>()),
  publishMessage: vi.fn(async (...args: unknown[]) => {
    published.push(args);
    return null;
  }),
}));

import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { messagingTools } from "./run-tools-messaging.js";

const findFirst = vi.fn();
const context = () =>
  ({
    deps: { prisma: { message: { findFirst } } },
    run: { id: "run-1", threadId: "t", sourceMessageId: "m1" },
  }) as unknown as RunContext;
const call = (args: Record<string, unknown>) =>
  ({ args, finish: async (result: unknown) => result }) as unknown as ToolCall;

describe("react_to_message", () => {
  it("posts the emoji as a quiet bot reply to the person's message", async () => {
    findFirst.mockResolvedValueOnce({
      id: "m1",
      role: "user",
      blocks: [{ kind: "text", text: "Thanks!" }],
      replyToMessageId: null,
    });
    await expect(
      messagingTools.react_to_message!(context(), call({ emoji: "❤️" })),
    ).resolves.toEqual({
      ok: true,
    });
    const [, , role, blocks, unread, nonce, , replyTo] = published[0]!;
    expect(role).toBe("bot");
    expect(blocks).toEqual([{ kind: "text", text: "❤️" }]);
    expect(unread).toBe(false);
    expect(nonce).toBe("react:run-1:m1:❤️");
    expect(replyTo).toBe("m1");
  });

  it("refuses an emoji outside the offered set", async () => {
    published.length = 0;
    const result = await messagingTools.react_to_message!(context(), call({ emoji: "💥" }));
    expect(result).toHaveProperty("error");
    expect(published).toHaveLength(0);
  });

  it("refuses a message that is not the person's", async () => {
    findFirst.mockResolvedValueOnce(null);
    const result = await messagingTools.react_to_message!(context(), call({ emoji: "👍" }));
    expect(result).toHaveProperty("error");
    expect(published).toHaveLength(0);
  });
});
