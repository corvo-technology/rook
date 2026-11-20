import type { MessageBlock } from "@corvo/contracts";
import { replyMarker } from "@corvo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReplyState, RunContext } from "./run-context.js";

const published = vi.hoisted(
  () => [] as Array<{ blocks: unknown; nonce?: string; replyTo?: string }>,
);
const failWith = vi.hoisted(() => ({ error: undefined as unknown }));

vi.mock("./run-messages.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./run-messages.js")>()),
  publishMessage: vi.fn(
    async (
      _deps: unknown,
      _run: unknown,
      _role: unknown,
      blocks: unknown,
      _unread: unknown,
      nonce?: string,
      _helper?: unknown,
      replyTo?: string,
    ) => {
      if (failWith.error) throw failWith.error;
      published.push({ blocks, nonce, replyTo });
      return null;
    },
  ),
}));

const { finalAnswers, noteSteeringClaimed } = await import("./run-answers.js");

const text = (value: string): MessageBlock => ({ kind: "text", text: value });
const steps = { kind: "steps", steps: [] } as unknown as MessageBlock;

function context(reply: Partial<ReplyState> = {}): RunContext {
  return {
    run: { id: "run-1", sourceMessageId: "m1", trigger: "user" },
    secrets: [],
    deps: {},
    state: {
      reply: {
        assembled: "",
        currentTextSegment: "",
        messageSegments: [],
        pendingToolNames: [],
        pendingProgress: "",
        answerTargets: [],
        answeredTargets: new Set<string>(),
        publishedMidTurnUserMessage: false,
        hasStreamedText: true,
        ...reply,
      },
    },
  } as unknown as RunContext;
}

beforeEach(() => {
  published.length = 0;
  failWith.error = undefined;
});

describe("answering messages sent during a run", () => {
  it("posts the finished answer under the earlier message and queues the follow-up", async () => {
    const ctx = context({ messageSegments: [steps, text("The report is ready.")] });

    await noteSteeringClaimed(ctx, ["m2"]);

    expect(published).toEqual([
      {
        blocks: [steps, text("The report is ready.")],
        nonce: "answer:run-1:m1",
        replyTo: "m1",
      },
    ]);
    expect(ctx.state.reply.messageSegments).toEqual([]);
    expect(ctx.state.reply.answerTargets).toEqual(["m2"]);
    expect(finalAnswers(ctx, [text("Also done.")])).toEqual([
      { replyToMessageId: "m2", blocks: [text("Also done.")] },
    ]);
  });

  it("keeps working text that ends on a step in the reply to the newest message", async () => {
    const ctx = context({ messageSegments: [text("Let me check."), steps] });

    await noteSteeringClaimed(ctx, ["m2"]);

    expect(published).toEqual([]);
    expect(finalAnswers(ctx, [text("All done.")])?.map((part) => part.replyToMessageId)).toEqual([
      "m2",
    ]);
  });

  it("splits one combined output per question and strips the markers", async () => {
    const ctx = context();
    await noteSteeringClaimed(ctx, ["m2", "m3"]);

    const parts = finalAnswers(ctx, [
      text(`${replyMarker("m2")}\nBlue.\n\n${replyMarker("m3")}\nFour.`),
    ]);

    expect(parts).toEqual([
      { replyToMessageId: "m2", blocks: [text("Blue.")] },
      { replyToMessageId: "m3", blocks: [text("Four.")] },
    ]);
  });

  it("does not post an answer twice when a resumed run claims the messages again", async () => {
    const ctx = context({
      answeredTargets: new Set(["m1", "m2"]),
      messageSegments: [text("Again.")],
    });

    await noteSteeringClaimed(ctx, ["m2"]);

    expect(published).toEqual([]);
    expect(finalAnswers(ctx, [text("Final.")])).toBeUndefined();
  });

  it("treats an answer already stored by an earlier attempt as posted", async () => {
    failWith.error = { code: "P2002" };
    const ctx = context({ messageSegments: [text("Done.")] });

    await noteSteeringClaimed(ctx, ["m2"]);

    expect(ctx.state.reply.answeredTargets.has("m1")).toBe(true);
    expect(ctx.state.reply.answerTargets).toEqual(["m2"]);
  });

  it("leaves a plain run without follow-ups alone", async () => {
    expect(finalAnswers(context(), [text("Hi")])).toBeUndefined();
  });
});
