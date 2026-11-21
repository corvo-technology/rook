import {
  type MessageBlock,
  TICKET_CRITERIA_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_REMAINING_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { loadBotMessageContext } from "./bot-messages.js";
import type { TicketChangeNotifier } from "./ticket-changes.js";
import { createTicket } from "./ticket-tools.js";

type DelegatedDeps = {
  prisma: PrismaClient;
  ticketBoardEnabled?: boolean;
  onTicketChange?: TicketChangeNotifier;
};

type DelegatedRun = {
  id: string;
  spaceId: string;
  botId: string;
  userId: string;
  trigger: string;
  ticketId?: string | null;
  sourceMessageId?: string | null;
};

const OPEN_STATUSES = ["todo", "doing", "review", "blocked"];

/** The agent that delegated this run's work and the goal it gave, or none for any other run. */
async function delegation(prisma: PrismaClient, run: DelegatedRun) {
  if (run.ticketId || !run.sourceMessageId) return undefined;
  if (run.trigger !== "bot_message" && run.trigger !== "follow_up") return undefined;
  const source = await prisma.message.findUnique({
    where: { id: run.sourceMessageId },
    select: { blocks: true },
  });
  const blocks = Array.isArray(source?.blocks) ? (source.blocks as MessageBlock[]) : [];
  const handoff = blocks.find(
    (block): block is Extract<MessageBlock, { kind: "handoff" }> =>
      block.kind === "handoff" && block.returnsToSender === true,
  );
  if (handoff) return { fromBotId: handoff.fromBotId, goal: handoff.text };
  const asked = await loadBotMessageContext(prisma, run.sourceMessageId);
  if (asked && (asked.intent === undefined || asked.intent === "request")) {
    return { fromBotId: asked.fromBotId, goal: asked.text };
  }
  // A follow-up whose handoff carries no return (a group transfer) is not delegated work.
  return undefined;
}

/**
 * A delegated run that stopped with work left becomes a ticket for the same agent, created by the
 * delegating bot, so the ticket loop (acceptance criteria, continuation, creator review) carries
 * the job to its end instead of the chat message being the last word. "Left" is what the agent
 * declared with work_remaining, or the work a run guard cut short; a finished run creates nothing.
 */
export async function ticketUnfinishedDelegation(
  deps: DelegatedDeps,
  run: DelegatedRun,
  why: { remaining?: string; cut: boolean },
): Promise<boolean> {
  const left = why.remaining?.trim().slice(0, TICKET_REMAINING_MAX_LENGTH);
  if (!deps.ticketBoardEnabled || !(left || why.cut)) return false;
  try {
    const from = await delegation(deps.prisma, run);
    if (!from) return false;
    // The sender may already have made this work a ticket; one open ticket is the loop.
    const open = await deps.prisma.ticket.findFirst({
      where: {
        spaceId: run.spaceId,
        assigneeBotId: run.botId,
        createdByBotId: from.fromBotId,
        status: { in: OPEN_STATUSES },
      },
      select: { id: true },
    });
    if (open) return false;
    const goal = from.goal.trim();
    const state = left ?? "A run limit stopped the work before it was done.";
    const result = await createTicket(deps, {
      spaceId: run.spaceId,
      botId: from.fromBotId,
      userId: run.userId,
      ownerBotId: run.botId,
      title: goal.replace(/\s+/g, " ").slice(0, TICKET_TITLE_MAX_LENGTH) || "Delegated work",
      description:
        `Delegated in chat and not finished in one run.\n\nGoal: ${goal}\n\nLeft: ${state}`.slice(
          0,
          TICKET_DESCRIPTION_MAX_LENGTH,
        ),
      acceptanceCriteria: `The goal is fully met: ${goal}\nStill to do: ${state}`.slice(
        0,
        TICKET_CRITERIA_MAX_LENGTH,
      ),
    });
    return "ticket" in result;
  } catch (error) {
    // The run is already finalized; the owner still has its report.
    getLogger().error("delegated work ticket", error);
    return false;
  }
}
