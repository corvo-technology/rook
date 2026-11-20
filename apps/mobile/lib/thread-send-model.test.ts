import { resolveComposerSendPlan } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import type { SendAttempt, SendPayload } from "./thread-feedback";
import { deliverSend } from "./thread-feedback";

function payload(extra: Partial<SendPayload> = {}): SendPayload {
  return {
    originThreadKey: "bot-1",
    displayText: "Hello",
    replyPreview: null,
    botTarget: "bot-1",
    initialBotTarget: "bot-1",
    reroutedToGroup: false,
    plan: resolveComposerSendPlan({ text: "Hello", mentions: [], hasAttachments: false }),
    attachments: [],
    replyQuote: null,
    ...extra,
  };
}

async function send(next: SendPayload) {
  const request = vi.fn().mockResolvedValue({ seq: 1 });
  await deliverSend(next, { clientNonce: "n-1", artifactIds: new Map() } as SendAttempt, request);
  return request.mock.calls.find(([path]) => path === "threads/send")?.[1] as Record<
    string,
    unknown
  >;
}

describe("a message sent on a chosen model", () => {
  it("carries the model it was written for, and only that message", async () => {
    const body = await send(payload({ model: { provider: "anthropic", modelId: "claude-x" } }));
    expect(body.model).toEqual({ provider: "anthropic", modelId: "claude-x" });
  });

  it("sends no model when none was chosen, so the agent's own applies", async () => {
    expect(await send(payload())).not.toHaveProperty("model");
  });
});
