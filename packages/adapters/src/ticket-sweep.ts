import type { JobPublisher } from "@corvo/adapter-kit";
import type { TicketStatus } from "@corvo/contracts";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_CONTINUATIONS_MAX,
  TICKET_REVIEW_ROUNDS_MAX,
  TicketStatusSchema,
  ticketRef,
} from "@corvo/contracts";
import { ticketCopy } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { ensureBoard, toBoardDto } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { botsOnFullComputers } from "./computer-storage-state.js";
import type { TicketChangeNotifier } from "./ticket-changes.js";
import { runMadeProgress, ticketOwnerLocale } from "./ticket-progress.js";
import { ticketReviewer, WORKING_RUN_STATUSES, wakeTicketAssignee } from "./ticket-wake.js";

/** A To do ticket this old has missed its wake (the agent was busy), so the sweep starts it. */
const TODO_IDLE_MS = 2 * 60_000;
/** A ticket in progress with no run and no change this long has stalled. */
const STALL_MS = 30 * 60_000;
/** A delivery waiting this long without a review run has been missed. */
const REVIEW_IDLE_MS = 10 * 60_000;
const PAGE = 50;
const OPEN_BLOCKER = { blocker: { status: { notIn: ["done", "closed"] } } };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

type SweepDeps = {
  prisma: PrismaClient;
  jobs: JobPublisher;
  ticketBoardEnabled?: boolean;
  onTicketChange?: TicketChangeNotifier;
};

/**
 * Keeps tickets moving when nothing else wakes them. Each pass, in order:
 * - a ticket in progress that has no run and has not changed for a while gets a follow-up run,
 *   and after `TICKET_CONTINUATIONS_MAX` of them without progress goes to Blocked with a comment
 *   that says why (a follow-up run that made progress starts the count over);
 * - a delivery in review with no review run is sent to its reviewer, and after
 *   `TICKET_REVIEW_ROUNDS_MAX` rounds to the person;
 * - an agent with nothing running starts its next To do ticket, one at a time;
 * - an agent whose computer is full starts nothing: its To do and In progress tickets go to
 *   Blocked with one comment that says why, and go back once there is room.
 * Only tickets with `sweepEligibleAt` are swept: new ones, and old ones a person has touched.
 * An agent with a run on a ticket is left alone, so no agent works two tickets at once.
 */
export function createTicketSweeper(deps: SweepDeps, options: { now?: () => Date } = {}) {
  return async (): Promise<void> => {
    if (!deps.ticketBoardEnabled) return;
    const now = (options.now ?? (() => new Date()))();
    const before = (ms: number) => new Date(now.getTime() - ms);
    const { prisma } = deps;

    // Waiting runs (on a person or an approval) are not stalls, so any run holds a ticket;
    // only a run that is working holds its agent.
    const runs = await prisma.run.findMany({
      where: {
        ticketId: { not: null },
        status: { in: [...WORKING_RUN_STATUSES, "waiting_input", "waiting_takeover"] },
      },
      select: { ticketId: true, botId: true, status: true },
    });
    const heldTickets = runs.flatMap((run) => (run.ticketId ? [run.ticketId] : []));
    const busyBots = new Set(
      runs.filter((run) => WORKING_RUN_STATUSES.includes(run.status)).map((run) => run.botId),
    );

    const full = await botsOnFullComputers(prisma, undefined, now);
    await resumeAfterStorage(deps, full);
    await pauseForStorage(deps, full, heldTickets);

    const stalled = await prisma.ticket.findMany({
      where: {
        status: "doing",
        sweepEligibleAt: { not: null },
        assigneeBotId: { not: null },
        updatedAt: { lt: before(STALL_MS) },
        id: { notIn: heldTickets },
      },
      orderBy: { updatedAt: "asc" },
      take: PAGE,
    });
    for (const ticket of stalled) {
      const botId = ticket.assigneeBotId;
      if (!botId || busyBots.has(botId) || full.has(botId)) continue;
      busyBots.add(botId);
      try {
        await resume(deps, ticket, botId);
      } catch (error) {
        getLogger().error("ticket stall sweep", error);
      }
    }

    const delivered = await prisma.ticket.findMany({
      where: {
        status: "review",
        sweepEligibleAt: { not: null },
        reviewRounds: { lte: TICKET_REVIEW_ROUNDS_MAX },
        updatedAt: { lt: before(REVIEW_IDLE_MS) },
        id: { notIn: heldTickets },
      },
      orderBy: { updatedAt: "asc" },
      take: PAGE,
    });
    for (const ticket of delivered) {
      try {
        const reviewer = await ticketReviewer(prisma, ticket);
        if (!reviewer || busyBots.has(reviewer) || full.has(reviewer)) continue;
        const claimed = await prisma.ticket.updateMany({
          where: { id: ticket.id, status: "review", reviewRounds: ticket.reviewRounds },
          data: { reviewRounds: { increment: 1 } },
        });
        if (claimed.count !== 1) continue;
        busyBots.add(reviewer);
        await wakeTicketAssignee(deps, {
          spaceId: ticket.spaceId,
          ticketId: ticket.id,
          botId: reviewer,
          kind: ticket.reviewRounds + 1 > TICKET_REVIEW_ROUNDS_MAX ? "escalate" : "review",
          skipIfActive: true,
        });
      } catch (error) {
        getLogger().error("ticket review sweep", error);
      }
    }

    const waiting = await prisma.ticket.groupBy({
      by: ["assigneeBotId"],
      where: {
        status: "todo",
        sweepEligibleAt: { not: null },
        assigneeBotId: { not: null, notIn: [...busyBots, ...full] },
        updatedAt: { lt: before(TODO_IDLE_MS) },
        blockedBy: { none: OPEN_BLOCKER },
      },
    });
    for (const { assigneeBotId } of waiting) {
      if (!assigneeBotId) continue;
      try {
        const queue = await prisma.ticket.findMany({
          where: {
            status: "todo",
            sweepEligibleAt: { not: null },
            assigneeBotId,
            updatedAt: { lt: before(TODO_IDLE_MS) },
            blockedBy: { none: OPEN_BLOCKER },
          },
          orderBy: { createdAt: "asc" },
          take: PAGE,
        });
        const next = queue.reduce<(typeof queue)[number] | undefined>(
          (best, ticket) =>
            !best ||
            (PRIORITY_RANK[ticket.priority ?? "normal"] ?? 2) <
              (PRIORITY_RANK[best.priority ?? "normal"] ?? 2)
              ? ticket
              : best,
          undefined,
        );
        if (!next) continue;
        await wakeTicketAssignee(deps, {
          spaceId: next.spaceId,
          ticketId: next.id,
          botId: assigneeBotId,
          skipIfActive: true,
        });
      } catch (error) {
        getLogger().error("ticket todo sweep", error);
      }
    }
  };
}

type StalledTicket = {
  id: string;
  boardId: string;
  spaceId: string;
  number: number;
  title: string;
  continuations: number;
};

/** One more follow-up run on a stalled ticket, or the end of them: Blocked, with the reason. */
async function resume(deps: SweepDeps, ticket: StalledTicket, botId: string) {
  const { prisma } = deps;
  const minutes = STALL_MS / 60_000;
  const copy = ticketCopy(await ticketOwnerLocale(prisma, botId));
  // Follow-ups that keep moving the ticket forward do not run the cap down.
  const latest = ticket.continuations
    ? await prisma.run.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, botId: true },
      })
    : null;
  const used =
    latest && (await runMadeProgress(prisma, { ...latest, ticketId: ticket.id }))
      ? 0
      : ticket.continuations;
  if (used < TICKET_CONTINUATIONS_MAX) {
    const claimed = await prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "doing", continuations: ticket.continuations },
        data: { continuations: used + 1 },
      });
      if (updated.count !== 1) return false;
      await tx.ticketComment.create({
        data: {
          ticketId: ticket.id,
          spaceId: ticket.spaceId,
          authorBotId: botId,
          body: copy.idle(minutes, used + 1, TICKET_CONTINUATIONS_MAX),
        },
      });
      return true;
    });
    if (claimed) {
      await wakeTicketAssignee(deps, {
        spaceId: ticket.spaceId,
        ticketId: ticket.id,
        botId,
        kind: "continue",
        skipIfActive: true,
      });
    }
    return;
  }
  const blocked = await prisma.$transaction(async (tx) => {
    const updated = await tx.ticket.updateMany({
      where: { id: ticket.id, status: "doing" },
      data: { status: "blocked" },
    });
    if (updated.count !== 1) return false;
    await tx.ticketComment.create({
      data: {
        ticketId: ticket.id,
        spaceId: ticket.spaceId,
        authorBotId: botId,
        body: copy.stalled(TICKET_CONTINUATIONS_MAX).slice(0, TICKET_COMMENT_MAX_LENGTH),
      },
    });
    return true;
  });
  if (!blocked) return;
  await announceMove(deps, ticket, botId, "blocked", "doing");
}

type MovedTicket = {
  id: string;
  boardId: string;
  spaceId: string;
  number: number;
  title: string;
};

/** Tells the board a ticket moved between columns, so open boards show it. */
async function announceMove(
  deps: SweepDeps,
  ticket: MovedTicket,
  botId: string,
  status: TicketStatus,
  previousStatus: TicketStatus,
) {
  if (!deps.onTicketChange) return;
  const { prisma } = deps;
  const board = await ensureBoard(prisma, ticket.spaceId);
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { name: true } });
  const statusLabel = toBoardDto(board).statusLabels[status];
  await deps.onTicketChange({
    spaceId: ticket.spaceId,
    boardId: ticket.boardId,
    ticketId: ticket.id,
    assigneeBotId: botId,
    wakeAssignee: false,
    moved: {
      ref: ticketRef(board.ticketPrefix, ticket.number),
      title: ticket.title,
      status,
      previousStatus,
      ...(statusLabel ? { statusLabel } : {}),
      byBotId: botId,
      byName: bot?.name ?? null,
    },
  });
}

/**
 * Agents whose computer is full start nothing: their To do and In progress tickets that no run
 * holds go to Blocked, each with one comment saying why, and remember where they were.
 */
async function pauseForStorage(deps: SweepDeps, full: Set<string>, held: string[]) {
  if (full.size === 0) return;
  const { prisma } = deps;
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["todo", "doing"] },
      sweepEligibleAt: { not: null },
      assigneeBotId: { in: [...full] },
      id: { notIn: held },
      blockedBy: { none: OPEN_BLOCKER },
    },
    take: PAGE,
  });
  for (const ticket of tickets) {
    const botId = ticket.assigneeBotId;
    const previous = TicketStatusSchema.safeParse(ticket.status);
    if (!botId || !previous.success) continue;
    try {
      const copy = ticketCopy(await ticketOwnerLocale(prisma, botId));
      const paused = await prisma.$transaction(async (tx) => {
        const updated = await tx.ticket.updateMany({
          where: { id: ticket.id, status: ticket.status },
          data: { status: "blocked", storagePausedFrom: ticket.status },
        });
        if (updated.count !== 1) return false;
        await tx.ticketComment.create({
          data: {
            ticketId: ticket.id,
            spaceId: ticket.spaceId,
            authorBotId: botId,
            body: copy.storageFull.slice(0, TICKET_COMMENT_MAX_LENGTH),
          },
        });
        return true;
      });
      if (paused) await announceMove(deps, ticket, botId, "blocked", previous.data);
    } catch (error) {
      getLogger().error("ticket storage pause", error);
    }
  }
}

/** Tickets paused for a full computer go back once it has room; one run per agent starts. */
async function resumeAfterStorage(deps: SweepDeps, full: Set<string>) {
  const { prisma } = deps;
  const paused = await prisma.ticket.findMany({
    where: { status: "blocked", storagePausedFrom: { not: null } },
    orderBy: { updatedAt: "asc" },
    take: PAGE,
  });
  const started = new Set<string>();
  for (const ticket of paused) {
    const botId = ticket.assigneeBotId;
    const back = TicketStatusSchema.safeParse(ticket.storagePausedFrom);
    if (!botId || !back.success || full.has(botId)) continue;
    try {
      const moved = await prisma.ticket.updateMany({
        where: { id: ticket.id, status: "blocked", storagePausedFrom: ticket.storagePausedFrom },
        data: { status: back.data, storagePausedFrom: null },
      });
      if (moved.count !== 1) continue;
      await announceMove(deps, ticket, botId, back.data, "blocked");
      if (started.has(botId)) continue;
      started.add(botId);
      await wakeTicketAssignee(deps, {
        spaceId: ticket.spaceId,
        ticketId: ticket.id,
        botId,
        kind: back.data === "doing" ? "continue" : "work",
        skipIfActive: true,
      });
    } catch (error) {
      getLogger().error("ticket storage resume", error);
    }
  }
}
