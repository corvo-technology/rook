import type { JobPublisher } from "@corvo/adapter-kit";
import type { BoardMove, BoardStep } from "@corvo/contracts";
import type { BoardEvents, PrismaClient } from "@corvo/db";
import { wakeTicketAssignee } from "./ticket-wake.js";

export type TicketChange = {
  spaceId: string;
  boardId: string;
  ticketId: string;
  assigneeBotId: string | null;
  wakeAssignee: boolean;
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
      });
    }
  };
}
