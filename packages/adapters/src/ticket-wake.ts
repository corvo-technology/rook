import type { JobPublisher } from "@corvo/adapter-kit";
import { runContinueJob } from "@corvo/adapter-kit";
import { isTicketCompletedStatus, TicketStatusSchema } from "@corvo/contracts";
import { CHIEF_BOT_SPAWN_KEY, escapePromptData } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";

const WORK_PROMPT = (ref: string) =>
  `Work on ticket ${ref}. Read it with ticket_get. Keep progress in ticket comments and update its status with ticket_update. Use ask or approval cards when user input is needed.`;

/**
 * What the woken agent is told. When it finishes and moves the ticket to review or done it says
 * so in its chat and sends the Chief a line, unless it is the Chief or the space has none.
 */
export function ticketWakePrompt(input: {
  ref: string;
  chief: { id: string; name: string } | null;
  assigneeIsChief: boolean;
}): string {
  const work = WORK_PROMPT(input.ref);
  if (!input.chief || input.assigneeIsChief) return work;
  return `${work} When you move it to review or done, say so in your chat and send the Chief (${escapePromptData(input.chief.name.replace(/\s+/g, " ").trim())}, id ${input.chief.id}) a one-line status with message_bot.`;
}

/** Assignment wakes only its current owner, without posting a chat message. */
export async function wakeTicketAssignee(
  deps: { prisma: PrismaClient; jobs: JobPublisher; ticketBoardEnabled?: boolean },
  input: { spaceId: string; ticketId: string; botId: string },
): Promise<void> {
  if (!deps.ticketBoardEnabled) return;
  const run = await deps.prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, spaceId: input.spaceId, assigneeBotId: input.botId },
      include: { board: { select: { ticketPrefix: true } } },
    });
    if (!ticket) return null;
    const status = TicketStatusSchema.safeParse(ticket.status);
    if (!status.success || isTicketCompletedStatus(status.data)) return null;
    const bot = await tx.bot.findFirst({
      where: { id: input.botId, spaceId: input.spaceId, archivedAt: null },
      select: { id: true, userId: true, thread: { select: { id: true } } },
    });
    if (!bot?.thread) return null;
    const chief = await tx.bot.findFirst({
      where: { spaceId: input.spaceId, spawnKey: CHIEF_BOT_SPAWN_KEY, archivedAt: null },
      select: { id: true, name: true },
    });
    const task = await tx.task.create({
      data: {
        spaceId: input.spaceId,
        botId: bot.id,
        threadId: bot.thread.id,
        userId: bot.userId,
        prompt: ticketWakePrompt({
          ref: `${ticket.board.ticketPrefix}-${ticket.number}`,
          chief,
          assigneeIsChief: chief?.id === bot.id,
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
  if (!run) return;
  await deps.jobs.enqueue(runContinueJob(run.id)).catch((error) => {
    getLogger().warn("ticket wake deferred to reconciliation", error);
  });
}
