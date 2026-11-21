import type { JobPublisher } from "@corvo/adapter-kit";
import type { BoardMove, BoardStep } from "@corvo/contracts";
import { isTicketCompletedStatus, TICKET_REVIEW_ROUNDS_MAX } from "@corvo/contracts";
import type { BoardEvents, PrismaClient } from "@corvo/db";
import { ticketReviewer, wakeTicketAssignee } from "./ticket-wake.js";

export type TicketChange = {
  spaceId: string;
  boardId: string;
  ticketId: string;
  assigneeBotId: string | null;
  wakeAssignee: boolean;
  /** The wake is a follow-up run on work that stopped short of its goal. */
  continuation?: boolean;
  /** Do not start a run while one for the ticket is already waiting or running. */
  skipIfActive?: boolean;
  /** The move is the run waiting on a person, not a delivery to review. */
  waiting?: boolean;
  /** Set when the ticket changed column. */
  moved?: BoardMove;
  /** The agent's latest step on the ticket, or null once its run ended. */
  step?: BoardStep | null;
};
export type TicketChangeNotifier = (change: TicketChange) => Promise<void>;

export function createTicketChangeNotifier(deps: {
  boardEvents: BoardEvents;
  prisma: PrismaClient;
  jobs: JobPublisher;
  ticketBoardEnabled?: boolean;
}): TicketChangeNotifier {
  return async (change) => {
    if (!deps.ticketBoardEnabled) return;
    await deps.boardEvents
      .notify(change.spaceId, {
        boardId: change.boardId,
        ticketId: change.ticketId,
        ...(change.moved ? { moved: change.moved } : {}),
        ...(change.step !== undefined ? { step: change.step } : {}),
      })
      .catch(() => undefined);
    if (change.wakeAssignee && change.assigneeBotId) {
      await wakeTicketAssignee(deps, {
        spaceId: change.spaceId,
        ticketId: change.ticketId,
        botId: change.assigneeBotId,
        kind: change.continuation ? "continue" : "work",
        ...(change.skipIfActive ? { skipIfActive: true } : {}),
      });
    }
    if (change.moved && !change.waiting) await followMove(deps, change, change.moved);
  };
}

type NotifierDeps = { prisma: PrismaClient; jobs: JobPublisher; ticketBoardEnabled?: boolean };

/**
 * What a column move sets off. Done wakes the tickets waiting on it. A bot's delivery to review
 * wakes its reviewer (its creator, or the Chief) to check it against the criteria, and past the round cap to ask the person.
 * A bot sending a ticket back from review wakes the owner to fix what was named.
 */
async function followMove(deps: NotifierDeps, change: TicketChange, moved: BoardMove) {
  const { prisma } = deps;
  if (isTicketCompletedStatus(moved.status)) {
    const waiting = await prisma.ticketDependency.findMany({
      where: { blockerId: change.ticketId, ticket: { status: "todo" } },
      select: { ticket: { select: { id: true, assigneeBotId: true } } },
    });
    for (const { ticket } of waiting) {
      if (!ticket.assigneeBotId) continue;
      await wakeTicketAssignee(deps, {
        spaceId: change.spaceId,
        ticketId: ticket.id,
        botId: ticket.assigneeBotId,
        skipIfActive: true,
      });
    }
    return;
  }
  if (!moved.byBotId) return;
  if (moved.status === "review") {
    const ticket = await prisma.ticket.findFirst({
      where: { id: change.ticketId, spaceId: change.spaceId },
      select: { spaceId: true, createdByBotId: true, assigneeBotId: true },
    });
    const reviewer = ticket && (await ticketReviewer(prisma, ticket));
    if (!reviewer || reviewer === moved.byBotId) return;
    const updated = await prisma.ticket.update({
      where: { id: change.ticketId },
      data: { reviewRounds: { increment: 1 } },
      select: { reviewRounds: true },
    });
    await wakeTicketAssignee(deps, {
      spaceId: change.spaceId,
      ticketId: change.ticketId,
      botId: reviewer,
      kind: updated.reviewRounds > TICKET_REVIEW_ROUNDS_MAX ? "escalate" : "review",
    });
    return;
  }
  if (
    moved.status === "doing" &&
    moved.previousStatus === "review" &&
    change.assigneeBotId &&
    moved.byBotId !== change.assigneeBotId
  ) {
    await prisma.ticket.update({ where: { id: change.ticketId }, data: { continuations: 0 } });
    await wakeTicketAssignee(deps, {
      spaceId: change.spaceId,
      ticketId: change.ticketId,
      botId: change.assigneeBotId,
      kind: "rework",
    });
  }
}
