import type { BoardMove, TicketStatus } from "@corvo/contracts";
import { TICKET_COMMENT_MAX_LENGTH, TICKET_CONTINUATIONS_MAX, ticketRef } from "@corvo/contracts";
import type { TicketStopReason } from "@corvo/core";
import { ticketCopy } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { coerceTicketStatus, ensureBoard, toBoardDto } from "@corvo/db";
import { botsOnFullComputers } from "./computer-storage-state.js";
import type { TicketChangeNotifier } from "./ticket-changes.js";
import { runMadeProgress, ticketOwnerLocale } from "./ticket-progress.js";

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
 * work remains (`remaining`, on the ticket or declared by the run), or a run guard cut it short.
 * The ticket stays In progress with a progress comment and a follow-up run starts from it, so
 * partial work never spends a review round; only a delivery the agent calls complete goes to
 * review. A run that made measurable progress starts the follow-up count over, so a long ticket
 * keeps going while it advances; after `TICKET_CONTINUATIONS_MAX` follow-ups without progress
 * the ticket goes to review with an honest account of where it stopped.
 */
async function continueUnfinished(
  deps: TicketRunDeps,
  run: TicketRun,
  why: { cut: boolean; reason: TicketStopReason; remaining?: string; progressed: boolean },
): Promise<{ kind: "continued" } | { kind: "capped" } | null> {
  const ticket = await deps.prisma.ticket.findFirst({
    where: { id: run.ticketId ?? "", spaceId: run.spaceId, assigneeBotId: run.botId },
  });
  const left = (ticket?.remaining ?? why.remaining)?.trim() || undefined;
  if (!ticket || !(left || why.cut)) return null;
  const open = ticket.status === "doing" || (why.cut && ticket.status === "review");
  if (!open) return null;
  const used = why.progressed ? 0 : ticket.continuations;
  const copy = ticketCopy(await ticketOwnerLocale(deps.prisma, run.botId));
  if (used >= TICKET_CONTINUATIONS_MAX) {
    await deps.prisma.ticket.updateMany({
      where: { id: ticket.id },
      data: { remaining: null },
    });
    await deps.prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: run.spaceId,
        authorBotId: run.botId,
        body: copy
          .capped(TICKET_CONTINUATIONS_MAX, why.reason, left)
          .slice(0, TICKET_COMMENT_MAX_LENGTH),
      },
    });
    return { kind: "capped" };
  }
  const claimed = await deps.prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: { id: ticket.id, continuations: ticket.continuations },
      data: { continuations: used + 1, status: "doing", remaining: null },
    });
    if (updated.count !== 1) return false;
    await tx.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: run.spaceId,
        authorBotId: run.botId,
        body: copy
          .continuing(used + 1, TICKET_CONTINUATIONS_MAX, why.reason, left)
          .slice(0, TICKET_COMMENT_MAX_LENGTH),
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
  outcome: /** `remaining` is the work the agent declared left with work_remaining. */
    | { kind: "finished"; cut?: boolean; remaining?: string }
    /** `comment` is what the board shows, in the person's language; `error` stays the English reason. */
    | { kind: "stopped"; error: string; comment?: string; cut?: boolean; remaining?: string },
): Promise<void> {
  if (!deps.ticketBoardEnabled || !run.ticketId) return;
  try {
    const stopped = outcome.kind === "stopped";
    const progressed = await runMadeProgress(
      deps.prisma,
      { id: run.id, botId: run.botId, ticketId: run.ticketId },
      { ticketEdits: true },
    );
    // A full computer cannot start a follow-up: the ticket is paused below, not continued.
    const computerFull =
      stopped && (await botsOnFullComputers(deps.prisma, [run.botId])).has(run.botId);
    const next = computerFull
      ? null
      : await continueUnfinished(deps, run, {
          cut: outcome.cut === true,
          progressed,
          ...(outcome.remaining?.trim() ? { remaining: outcome.remaining.trim() } : {}),
          reason: stopped
            ? { kind: "text", text: outcome.comment ?? outcome.error }
            : outcome.cut
              ? { kind: "cut" }
              : { kind: "left" },
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
    // Blocked because the computer is full: the sweep puts it back once there is room.
    if (computerFull) {
      await deps.prisma.ticket.updateMany({
        where: { id: run.ticketId, status: "blocked" },
        data: { storagePausedFrom: "doing" },
      });
    }
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
