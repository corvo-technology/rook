import type { MessageBlock } from "@corvo/contracts";
import { redactSecrets, splitReplyByMessage } from "@corvo/core";
import type { RunContext } from "./run-context.js";
import { isUniqueViolation, publishMessage } from "./run-messages.js";
import { paceBotMessage } from "./run-pacing.js";
import { flushPendingTools, flushProgress } from "./run-progress.js";
import { answerClientNonce } from "./user-progress.js";

/**
 * The run just took in person messages sent while it worked. An answer already finished for an
 * earlier message goes out now, under that message; the next answer is theirs.
 */
export async function noteSteeringClaimed(ctx: RunContext, messageIds: readonly string[]) {
  const { reply } = ctx.state;
  const fresh = messageIds.filter(
    (id) => !reply.answeredTargets.has(id) && !reply.answerTargets.includes(id),
  );
  if (fresh.length === 0) return;
  await flushProgress(ctx);
  flushPendingTools(reply);
  const earlier = reply.answerTargets.length
    ? reply.answerTargets
    : ctx.run.sourceMessageId && !reply.answeredTargets.has(ctx.run.sourceMessageId)
      ? [ctx.run.sourceMessageId]
      : [];
  const finished = reply.messageSegments.at(-1);
  if (earlier.length && finished?.kind === "text" && finished.text.trim()) {
    const blocks = reply.messageSegments.map((block) =>
      block.kind === "text" ? { ...block, text: redactSecrets(block.text, ctx.secrets) } : block,
    );
    for (const part of splitReplyByMessage(blocks, earlier)) {
      await publishAnswer(ctx, part.replyToMessageId, part.blocks);
      reply.answeredTargets.add(part.replyToMessageId);
    }
    reply.answerTargets = [];
    reply.messageSegments = [];
    reply.currentTextSegment = "";
    reply.assembled = "";
    reply.pendingProgress = "";
    reply.hasStreamedText = false;
    reply.publishedMidTurnUserMessage = true;
  }
  reply.answerTargets = [...reply.answerTargets, ...fresh];
}

async function publishAnswer(ctx: RunContext, replyToMessageId: string, blocks: MessageBlock[]) {
  try {
    await paceBotMessage(
      ctx,
      blocks.map((block) => (block.kind === "text" ? block.text : "")).join(""),
    );
    await publishMessage(
      ctx.deps,
      ctx.run,
      "bot",
      blocks,
      undefined,
      answerClientNonce(ctx.run.id, replyToMessageId),
      undefined,
      replyToMessageId,
    );
  } catch (error) {
    // A resumed run already posted this answer.
    if (!isUniqueViolation(error)) throw error;
  }
}

/** The final reply as one message per person message it answers. */
export function finalAnswers(ctx: RunContext, blocks: MessageBlock[]) {
  const targets = ctx.state.reply.answerTargets.filter(
    (id) => !ctx.state.reply.answeredTargets.has(id),
  );
  return targets.length ? splitReplyByMessage(blocks, targets) : undefined;
}
