import type { MessageBlock } from "@corvo/contracts";
import { checkHostActionCall, sanitizeHostTurn } from "@corvo/core";
import { appendEventInTransaction, createThreadMessageInTransaction } from "@corvo/db";
import { runScopedToolExecutionId } from "./run-effects.js";
import { flushProgress, publishMidTurnNarration } from "./run-progress.js";
import type { ToolHandlers } from "./run-tool-gate.js";

/**
 * The agent offers one of the actions the partner's page registered for this turn. The offer is a
 * card in the chat; the person confirms it there, and only then does the page act. A name or
 * params that do not fit what the page registered never reach the card.
 */
export const hostActionTools: ToolHandlers = {
  async propose_host_action(ctx, call) {
    const { deps, run, runId, bot } = ctx;
    const { args, executionId } = call;
    const host = sanitizeHostTurn(run.hostContext);
    const checked = checkHostActionCall(host?.actions, args.action, args.params);
    if (!checked.ok) return call.finish({ error: checked.error });
    await flushProgress(ctx);
    await publishMidTurnNarration(ctx, true);
    const actionId = runScopedToolExecutionId(runId, executionId).slice(0, 64);
    const block: MessageBlock = {
      kind: "host_action",
      actionId,
      name: checked.action.name,
      label: checked.action.description || checked.action.name,
      params: checked.params,
      status: "pending",
    };
    const target = { spaceId: run.spaceId, threadId: run.threadId, botId: bot.id };
    const event = await deps.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
      const nonce = `host-action:${actionId}`;
      const replayed = await tx.message.findFirst({
        where: { threadId: target.threadId, clientNonce: nonce },
        select: { id: true },
      });
      if (replayed) return null;
      const message = await createThreadMessageInTransaction(tx, {
        threadId: target.threadId,
        botId: target.botId,
        runId,
        role: "bot",
        blocks: [block],
        clientNonce: nonce,
      });
      return appendEventInTransaction(tx, {
        ...target,
        runId,
        type: "thread.message.created",
        payload: { messageId: message.id, role: "bot", blocks: [block] },
      });
    });
    if (event) {
      await deps.events.notify(target.threadId, event.seq, event.firstResponse ? runId : undefined);
    }
    return call.finish({
      status: "pending",
      message: "The card is shown. Wait for the person to confirm; do not say it is done.",
    });
  },
};
