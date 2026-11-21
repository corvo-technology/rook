import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  warmThreadContentKey,
  withTransactionRetry,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { ExecutorDeps } from "./executor-deps.js";

/**
 * A bot another bot created waits for its owner in its own chat, which nobody is looking at: a
 * desktop or web notification only fires for the chat that is open. This leaves a line in the chat
 * of the bot that created it, the one the owner keeps open, so the wait is seen and followed.
 * It never fails the run it reports on.
 */
export async function noteApprovalInParentChat(
  deps: Pick<ExecutorDeps, "prisma" | "events">,
  input: {
    bot: { id: string; name: string; spaceId: string; userId: string; parentBotId: string | null };
    effectId: string;
  },
): Promise<void> {
  const { bot, effectId } = input;
  if (!bot.parentBotId) return;
  try {
    const parent = await deps.prisma.bot.findFirst({
      where: { id: bot.parentBotId, spaceId: bot.spaceId, userId: bot.userId, archivedAt: null },
      select: { id: true },
    });
    if (!parent) return;
    const thread = await deps.prisma.thread.findUnique({
      where: { botId: parent.id },
      select: { id: true },
    });
    if (!thread) return;
    const blocks = [{ kind: "text" as const, text: `${bot.name} is waiting for your approval.` }];
    await warmThreadContentKey(deps.prisma, thread.id);
    const seq = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        const message = await createThreadMessageInTransaction(tx, {
          threadId: thread.id,
          role: "bot",
          blocks,
          botId: parent.id,
          // One line per approval, however many times the card is shown again.
          clientNonce: `approval-notice:${effectId}`,
        });
        const event = await appendEventInTransaction(tx, {
          spaceId: bot.spaceId,
          threadId: thread.id,
          botId: parent.id,
          type: "thread.message.created",
          payload: { messageId: message.id, role: "bot", blocks },
        });
        return event.seq;
      }),
    );
    await deps.events.notify(thread.id, seq).catch((error) => {
      getLogger().error("approval notice realtime notification", error);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return;
    getLogger().error("approval notice in parent chat", error);
  }
}
