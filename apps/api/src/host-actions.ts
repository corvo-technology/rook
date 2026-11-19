import type { Actor, HostActionOutcome, MessageBlock } from "@corvo/contracts";
import type { PrismaClient, ThreadEvents } from "@corvo/db";
import { appendEventInTransaction, IsolationError, runAsSystem } from "@corvo/db";
import { resolveThreadTarget } from "./thread-target.js";

/** Only a partner's customer, in the frame the partner embedded, may bring a page's context. */
export async function isPartnerCustomer(prisma: PrismaClient, actor: Actor): Promise<boolean> {
  const tenant = await runAsSystem("partner customer lookup", () =>
    prisma.partnerTenant.findFirst({
      where: { ownerUserId: actor.userId },
      select: { id: true },
    }),
  );
  return tenant !== null;
}

/**
 * Records the person's decision on an action card, once. The card is the only place an action
 * can be confirmed, and a card that is no longer pending (already decided) changes nothing.
 */
export async function resolveHostAction(
  deps: { prisma: PrismaClient; events: ThreadEvents },
  actor: Actor,
  input: {
    botId: string;
    messageId: string;
    actionId: string;
    actionName: string;
    outcome: HostActionOutcome;
  },
): Promise<void> {
  const target = await resolveThreadTarget(deps.prisma, actor, { botId: input.botId });
  if (target.kind !== "bot") throw new IsolationError();
  const event = await deps.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const message = await tx.message.findFirst({
      where: { id: input.messageId, threadId: target.threadId },
      select: { id: true, blocks: true },
    });
    if (!message) throw new IsolationError();
    const blocks = message.blocks as MessageBlock[];
    const index = blocks.findIndex(
      (block) =>
        block.kind === "host_action" &&
        block.actionId === input.actionId &&
        block.name === input.actionName,
    );
    const block = blocks[index];
    if (!block || block.kind !== "host_action" || block.status !== "pending") return null;
    const next = blocks.map((candidate, i) =>
      i === index ? { ...block, status: input.outcome } : candidate,
    );
    await tx.message.update({ where: { id: message.id }, data: { blocks: next } });
    return appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId: target.threadId,
      botId: input.botId,
      type: "thread.message.updated",
      payload: { messageId: message.id, role: "bot", blocks: next },
    });
  });
  if (event) await deps.events.notify(target.threadId, event.seq);
}
