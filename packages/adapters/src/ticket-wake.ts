import type { JobPublisher } from "@corvo/adapter-kit";
import { runContinueJob } from "@corvo/adapter-kit";
import {
  isTicketCompletedStatus,
  TICKET_REVIEW_ROUNDS_MAX,
  TicketStatusSchema,
} from "@corvo/contracts";
import { escapePromptData } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { CHIEF_SPAWN_KEY } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { botsOnFullComputers } from "./computer-storage-state.js";

/**
 * Why a ticket run starts. `work` and `continue` and `rework` go to the owner; `review` and
 * `escalate` go to the ticket's creator, who checks the delivery against its criteria.
 */
export type TicketWakeKind = "work" | "continue" | "rework" | "review" | "escalate";

const OWNER_KINDS: ReadonlySet<TicketWakeKind> = new Set(["work", "continue", "rework"]);

/** What the woken agent is told; the standing rules live in the ticket run guidance. */
export function ticketWakePrompt(input: {
  ref: string;
  kind?: TicketWakeKind;
  /** Review only: who delivered it and which round this is. */
  assignee?: string;
  round?: number;
}): string {
  const { ref } = input;
  switch (input.kind ?? "work") {
    case "continue":
      return `Continue ticket ${ref}. Read it with ticket_get: your last checkpoint comment says what is done and what is left. Pick up from there without redoing finished work.`;
    case "rework":
      return `Ticket ${ref} came back from review. Read the latest comment with ticket_get, fix exactly what it says is missing, then move the ticket to review again.`;
    case "review": {
      const who = input.assignee
        ? ` delivered by ${escapePromptData(input.assignee.replace(/\s+/g, " ").trim())}`
        : "";
      return `Review ticket ${ref}${who}, round ${input.round ?? 1} of ${TICKET_REVIEW_ROUNDS_MAX}. Read it with ticket_get, then check the delivered artifact against the acceptance criteria yourself: open the file or count the rows, do not trust the summary. If every criterion is met, set the ticket to done with ticket_update. If something is missing and the work can go on, add one ticket_comment saying exactly what is missing and set the ticket back to doing. If the owner states a real blocker, tell the person with message_user in 2 to 4 sentences: what is done, what is missing, and the one decision you need. Say nothing in chat otherwise, unless approving this finishes the whole plan: then tell the person in 2 to 4 sentences with a link or reference to the result.`;
    }
    case "escalate":
      return `Ticket ${ref} still does not meet its acceptance criteria after ${TICKET_REVIEW_ROUNDS_MAX} review rounds. Tell the person with message_user in 2 to 4 sentences: what is done, what is missing, and the one decision you need from them. Leave the ticket in review.`;
    default:
      return `Work on ticket ${ref}. Read it with ticket_get: description, acceptance criteria and comments. Keep progress in ticket comments and its status current with ticket_update. Use ask or approval cards when user input is needed.`;
  }
}

/** Tickets a ticket is still waiting on: every blocker that is not done or closed. */
export async function openBlockerCount(
  db: Pick<PrismaClient, "ticketDependency">,
  ticketId: string,
): Promise<number> {
  return db.ticketDependency.count({
    where: { ticketId, blocker: { status: { notIn: ["done", "closed"] } } },
  });
}

/** Run states that mean an agent is working right now. */
export const WORKING_RUN_STATUSES = ["queued", "leased", "running"];

/**
 * Who checks a delivery: the agent that created the ticket, or when it made the ticket for itself
 * (or is gone), the Chief, so a delivery never waits for a reviewer that does not exist. A ticket
 * a person created is reviewed by that person, so it has no agent reviewer.
 */
export async function ticketReviewer(
  db: Pick<PrismaClient, "bot">,
  ticket: { spaceId: string; createdByBotId: string | null; assigneeBotId: string | null },
): Promise<string | null> {
  if (!ticket.createdByBotId) return null;
  const creator = await db.bot.findFirst({
    where: { id: ticket.createdByBotId, spaceId: ticket.spaceId, archivedAt: null },
    select: { id: true },
  });
  if (creator && creator.id !== ticket.assigneeBotId) return creator.id;
  const chief = await db.bot.findFirst({
    where: { spaceId: ticket.spaceId, spawnKey: CHIEF_SPAWN_KEY, archivedAt: null },
    select: { id: true },
  });
  return chief && chief.id !== ticket.assigneeBotId ? chief.id : null;
}

/**
 * Starts a background run on a ticket without posting a chat message. Owner kinds go to the
 * current owner and wait while a blocker is open; `review` and `escalate` go to the creator.
 * A new `work` run also waits while the agent is busy on another ticket: one active ticket per
 * agent, and the ticket sweep starts the next one when the agent is free. Returns whether a run
 * was queued.
 */
export async function wakeTicketAssignee(
  deps: { prisma: PrismaClient; jobs: JobPublisher; ticketBoardEnabled?: boolean },
  input: {
    spaceId: string;
    ticketId: string;
    botId: string;
    kind?: TicketWakeKind;
    /** Skip when a run for the ticket is already waiting or running (a blocker finishing twice). */
    skipIfActive?: boolean;
  },
): Promise<boolean> {
  if (!deps.ticketBoardEnabled) return false;
  const kind = input.kind ?? "work";
  const owner = OWNER_KINDS.has(kind);
  const run = await deps.prisma.$transaction(async (tx) => {
    // A full computer cannot start the run; the sweep pauses its tickets and resumes them later.
    if ((await botsOnFullComputers(tx, [input.botId])).size > 0) return null;
    const ticket = await tx.ticket.findFirst({
      where: {
        id: input.ticketId,
        spaceId: input.spaceId,
        ...(owner ? { assigneeBotId: input.botId } : {}),
      },
      include: {
        board: { select: { ticketPrefix: true } },
        assigneeBot: { select: { name: true } },
      },
    });
    if (!ticket) return null;
    const status = TicketStatusSchema.safeParse(ticket.status);
    if (!status.success || isTicketCompletedStatus(status.data)) return null;
    if (!owner && status.data !== "review") return null;
    if (owner && (await openBlockerCount(tx, ticket.id)) > 0) return null;
    if (
      input.skipIfActive &&
      (await tx.run.findFirst({
        where: { ticketId: ticket.id, status: { in: WORKING_RUN_STATUSES } },
        select: { id: true },
      }))
    ) {
      return null;
    }
    if (
      kind === "work" &&
      (await tx.run.findFirst({
        where: {
          botId: input.botId,
          ticketId: { not: ticket.id },
          status: { in: WORKING_RUN_STATUSES },
        },
        select: { id: true },
      }))
    ) {
      return null;
    }
    const bot = await tx.bot.findFirst({
      where: { id: input.botId, spaceId: input.spaceId, archivedAt: null },
      select: { id: true, userId: true, thread: { select: { id: true } } },
    });
    if (!bot?.thread) return null;
    const task = await tx.task.create({
      data: {
        spaceId: input.spaceId,
        botId: bot.id,
        threadId: bot.thread.id,
        userId: bot.userId,
        prompt: ticketWakePrompt({
          ref: `${ticket.board.ticketPrefix}-${ticket.number}`,
          kind,
          assignee: ticket.assigneeBot?.name,
          round: ticket.reviewRounds,
        }),
        status: "queued",
      },
    });
    return tx.run.create({
      data: {
        spaceId: input.spaceId,
        botId: bot.id,
        threadId: bot.thread.id,
        userId: bot.userId,
        taskId: task.id,
        trigger: "tickets",
        ticketId: ticket.id,
        status: "queued",
      },
    });
  });
  if (!run) return false;
  await deps.jobs.enqueue(runContinueJob(run.id)).catch((error) => {
    getLogger().warn("ticket wake deferred to reconciliation", error);
  });
  return true;
}
