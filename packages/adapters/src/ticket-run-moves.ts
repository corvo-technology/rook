import type { BoardMove, TicketStatus } from "@corvo/contracts";
import { TICKET_COMMENT_MAX_LENGTH, TICKET_CONTINUATIONS_MAX, ticketRef } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { coerceTicketStatus, ensureBoard, toBoardDto } from "@corvo/db";
import type { TicketChangeNotifier } from "./ticket-changes.js";

type TicketRunDeps = {
  prisma: PrismaClient;
  ticketBoardEnabled?: boolean;
  onTicketChange?: TicketChangeNotifier;
};

/** The part of a run these rules read: the ticket it was woken for and the agent that runs it. */
export type TicketRun = { id: string; spaceId: string; botId: string; ticketId?: string | null };

const STEP_MAX_LENGTH = 120;

/**
 * Move the run's ticket from one column to the next, but only from the column the rule names. A
 * ticket somewhere else was moved by a person or by the agent itself, so it stays; the same rule
 * run twice finds the ticket already moved and does nothing. A column the rule reaches back to
 * (`placed`) counts only while the run itself put the ticket there, so a person's own move to
 * Review is never undone by the run resuming. A block also leaves the run's error as a comment
 * by the agent, in the same write as the move.
 */
async function moveRunTicket(
  deps: TicketRunDeps,
  run: TicketRun,
  move: { from: TicketStatus; placed?: TicketStatus; to: TicketStatus; comment?: string },
  waiting = false,
): Promise<void> {
  if (!deps.ticketBoardEnabled || !run.ticketId) return;
  const ticketId = run.ticketId;
  let from = move.from;
  const row = await deps.prisma.$transaction(async (tx) => {
    if (move.placed) {
      const own = await tx.run.findFirst({
        where: { id: run.id, ticketStatus: move.placed },
        select: { id: true },
      });
      if (own) from = move.placed;
    }
    const moved = await tx.ticket.updateMany({
      where: { id: ticketId, spaceId: run.spaceId, assigneeBotId: run.botId, status: from },
      data: { status: move.to },
    });
    if (moved.count !== 1) return null;
    await tx.run.update({ where: { id: run.id }, data: { ticketStatus: move.to } });
    if (move.comment) {
      await tx.ticketComment.create({
        data: {
          ticketId,
          spaceId: run.spaceId,
          authorBotId: run.botId,
          body: move.comment.slice(0, TICKET_COMMENT_MAX_LENGTH),
        },
      });
    }
    return tx.ticket.findUnique({ where: { id: ticketId } });
  });
  if (!row) return;
  const board = await ensureBoard(deps.prisma, run.spaceId);
  const bot = await deps.prisma.bot.findUnique({
    where: { id: run.botId },
    select: { name: true },
  });
  const status = coerceTicketStatus(row.status);
  const statusLabel = toBoardDto(board).statusLabels[status];
  const moved: BoardMove = {
    ref: ticketRef(board.ticketPrefix, row.number),
    title: row.title,
    status,
    previousStatus: from,
    ...(statusLabel ? { statusLabel } : {}),
    byBotId: run.botId,
    byName: bot?.name ?? null,
  };
  await deps.onTicketChange?.({
    spaceId: run.spaceId,
    boardId: board.id,
    ticketId,
    assigneeBotId: row.assigneeBotId,
    wakeAssignee: false,
    moved,
    ...(waiting ? { waiting: true } : {}),
  });
}

/**
 * The run is working: a ticket still waiting in To do is now being worked on, and so is one this
 * run itself sent to Review while it waited for a person.
 */
export async function startTicketRun(deps: TicketRunDeps, run: TicketRun): Promise<void> {
  await moveRunTicket(deps, run, { from: "todo", placed: "review", to: "doing" });
}

/** The run now waits on an approval or a person: the ticket is in Review and the step goes. */
export async function waitTicketRun(deps: TicketRunDeps, run: TicketRun): Promise<void> {
  if (!deps.ticketBoardEnabled || !run.ticketId) return;
  try {
    await moveRunTicket(deps, run, { from: "doing", to: "review" }, true);
    await announceTicketStep(deps, run, null);
  } catch {
    // The run is already paused; the board catches up on the next change.
  }
}

/**
 * A run that ends with the goal not met continues instead of ending the ticket: the agent said
 * work remains (`remaining`), or a run guard cut it short. Each follow-up is a new run that
 * starts from the checkpoint comment; after `TICKET_CONTINUATIONS_MAX` of them the ticket goes
 * to review with an honest account of where it stopped.
 */
async function continueUnfinished(
  deps: TicketRunDeps,
  run: TicketRun,
  why: { cut: boolean; reason: string },
): Promise<{ kind: "continued" } | { kind: "capped" } | null> {
  const ticket = await deps.prisma.ticket.findFirst({
    where: { id: run.ticketId ?? "", spaceId: run.spaceId, assigneeBotId: run.botId },
  });
  if (!ticket || !(ticket.remaining || why.cut)) return null;
  const open = ticket.status === "doing" || (why.cut && ticket.status === "review");
  if (!open) return null;
  const left = ticket.remaining?.trim();
  if (ticket.continuations >= TICKET_CONTINUATIONS_MAX) {
    await deps.prisma.ticket.updateMany({
      where: { id: ticket.id },
      data: { remaining: null },
    });
    await deps.prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: run.spaceId,
        authorBotId: run.botId,
        body: `Stopped after ${TICKET_CONTINUATIONS_MAX} follow-up runs without meeting the acceptance criteria. ${left ? `Still left: ${left} ` : ""}Why it stopped: ${why.reason}`.slice(
          0,
          TICKET_COMMENT_MAX_LENGTH,
        ),
      },
    });
    return { kind: "capped" };
  }
  const claimed = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: { id: ticket.id, continuations: ticket.continuations },
      data: { continuations: { increment: 1 }, status: "doing", remaining: null },
    });
    if (updated.count !== 1) return false;
    await tx.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: run.spaceId,
        authorBotId: run.botId,
        body: `Continuing (follow-up ${ticket.continuations + 1} of ${TICKET_CONTINUATIONS_MAX}). ${why.reason}${left ? ` Left: ${left}` : ""}`.slice(
          0,
          TICKET_COMMENT_MAX_LENGTH,
        ),
      },
    });
    return true;
  });
  if (!claimed) return null;
  await deps.onTicketChange?.({
    spaceId: run.spaceId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    assigneeBotId: ticket.assigneeBotId,
    wakeAssignee: true,
    continuation: true,
  });
  return { kind: "continued" };
}

/**
 * The run ended: its step leaves the card, and the ticket moves on from In progress. Work that
 * stopped short of its goal continues in a follow-up run instead (`cut`: a run guard ended it).
 */
export async function endTicketRun(
  deps: TicketRunDeps,
  run: TicketRun,
  outcome:
    | { kind: "finished"; cut?: boolean }
    /** `comment` is what the board shows, in the person's language; `error` stays the English reason. */
    | { kind: "stopped"; error: string; comment?: string; cut?: boolean },
): Promise<void> {
  if (!deps.ticketBoardEnabled || !run.ticketId) return;
  try {
    const stopped = outcome.kind === "stopped";
    const next = await continueUnfinished(deps, run, {
      cut: outcome.cut === true,
      reason: stopped
        ? outcome.error
        : outcome.cut
          ? "A tool call limit ended the run."
          : "The run ended with work left.",
    });
    if (next?.kind === "continued") {
      await announceTicketStep(deps, run, null);
      return;
    }
    await moveRunTicket(
      deps,
      run,
      next?.kind === "capped"
        ? { from: "doing", to: "review" }
        : outcome.kind === "finished"
          ? { from: "doing", to: "review" }
          : {
              from: "doing",
              placed: "review",
              to: "blocked",
              comment: outcome.comment ?? outcome.error,
            },
    );
    await announceTicketStep(deps, run, null);
  } catch {
    // The run is already finalized; the board catches up on the next change.
  }
}

/** Tell the board what the agent is doing on the run's ticket now, or that it stopped (null). */
export async function announceTicketStep(
  deps: TicketRunDeps,
  run: TicketRun,
  text: string | null,
): Promise<void> {
  if (!deps.ticketBoardEnabled || !run.ticketId || !deps.onTicketChange) return;
  const step = text?.replace(/\s+/g, " ").trim();
  if (text !== null && !step) return;
  const ticket = await deps.prisma.ticket.findFirst({
    where: { id: run.ticketId, spaceId: run.spaceId },
    select: { boardId: true, assigneeBotId: true },
  });
  if (!ticket) return;
  await deps.onTicketChange({
    spaceId: run.spaceId,
    boardId: ticket.boardId,
    ticketId: run.ticketId,
    assigneeBotId: ticket.assigneeBotId,
    wakeAssignee: false,
    step: step ? { botId: run.botId, text: step.slice(0, STEP_MAX_LENGTH) } : null,
  });
}
