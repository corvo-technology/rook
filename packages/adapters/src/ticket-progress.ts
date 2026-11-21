import type { RunErrorInfo } from "@corvo/contracts";
import { localizedFailureLine, ticketCopy } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";

/** The language of the person who owns the agent, for comments the server writes on a ticket. */
export async function ticketOwnerLocale(
  prisma: PrismaClient,
  botId: string,
): Promise<string | undefined> {
  try {
    const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { userId: true } });
    if (!bot?.userId) return undefined;
    const user = await prisma.user.findUnique({
      where: { id: bot.userId },
      select: { locale: true },
    });
    return user?.locale ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a run on a ticket moved it forward: its agent commented or left new files, and, while
 * the run is still ending (`ticketEdits`), changed the ticket itself. Once the run has moved the
 * ticket between columns its own move would read as an edit, so later checks leave that out.
 * Read before the server writes its own comments, so those never count. A run with no record
 * counts as no progress.
 */
export async function runMadeProgress(
  prisma: PrismaClient,
  run: { id: string; botId: string; ticketId: string },
  options: { ticketEdits?: boolean } = {},
): Promise<boolean> {
  try {
    const row = await prisma.run.findUnique({
      where: { id: run.id },
      select: { createdAt: true },
    });
    if (!row) return false;
    const since = row.createdAt;
    const [comment, artifact, ticket] = await Promise.all([
      prisma.ticketComment.findFirst({
        where: { ticketId: run.ticketId, authorBotId: run.botId, createdAt: { gt: since } },
        select: { id: true },
      }),
      prisma.artifact.findFirst({ where: { runId: run.id }, select: { id: true } }),
      options.ticketEdits
        ? prisma.ticket.findUnique({ where: { id: run.ticketId }, select: { updatedAt: true } })
        : null,
    ]);
    return Boolean(comment || artifact || (ticket && ticket.updatedAt > since));
  } catch {
    return false;
  }
}

/**
 * What a failed run says on its ticket, in the owner's language: a connection out of credits is
 * named so they know where to add them, any other failure uses the run's own short line.
 */
export function ticketFailureComment(
  info: RunErrorInfo | undefined,
  locale: string | undefined,
): string | undefined {
  if (!info) return undefined;
  if (info.code === "model_provider_error" && info.params?.kind === "credit") {
    return ticketCopy(locale).outOfCredits;
  }
  return localizedFailureLine(info.code, locale);
}
