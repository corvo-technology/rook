import type { Actor, PendingApproval } from "@corvo/contracts";
import { MessageBlock as MessageBlockSchema } from "@corvo/contracts";
import { can, isApprovalAskBlock } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getSpaceMembership } from "./space-owner.js";

/** Most waiting runs one inbox reads; a space with more has bigger problems than an inbox. */
const WAITING_RUN_LIMIT = 200;

/**
 * Every approval waiting on the actor, across all chats: those of agents they own, and every
 * agent's when they hold `approve_actions`. The deciding transaction checks again who may decide,
 * so this list is a view of the gate, not the gate. A private channel the actor cannot see is
 * left out unless the agent is theirs.
 */
export async function listPendingApprovals(
  prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId">,
): Promise<PendingApproval[]> {
  const membership = await getSpaceMembership(prisma, actor);
  if (!membership) return [];
  const mayDecideAll = can(membership, "approve_actions");
  const runs = await prisma.run.findMany({
    where: {
      spaceId: actor.spaceId,
      status: "waiting_input",
      bot: { archivedAt: null, ...(mayDecideAll ? {} : { userId: actor.userId }) },
    },
    orderBy: { createdAt: "asc" },
    take: WAITING_RUN_LIMIT,
    select: {
      id: true,
      bot: { select: { id: true, name: true, color: true, userId: true } },
      thread: {
        select: {
          group: {
            select: {
              id: true,
              name: true,
              userId: true,
              archivedAt: true,
              people: { select: { userId: true } },
            },
          },
        },
      },
    },
  });
  const seen = runs.filter((run) => {
    const group = run.thread.group;
    if (!group) return true;
    if (group.archivedAt) return false;
    if (run.bot.userId === actor.userId || group.userId === actor.userId) return true;
    return group.people.length === 0 || group.people.some((row) => row.userId === actor.userId);
  });
  if (seen.length === 0) return [];
  const messages = await prisma.message.findMany({
    where: { runId: { in: seen.map((run) => run.id) }, role: "bot" },
    orderBy: [{ createdAt: "asc" }, { seq: "asc" }],
    select: { id: true, runId: true, blocks: true, createdAt: true },
  });
  const byRun = new Map(seen.map((run) => [run.id, run]));
  return messages.flatMap((message) => {
    const run = message.runId ? byRun.get(message.runId) : undefined;
    const parsed = MessageBlockSchema.array().safeParse(message.blocks);
    if (!run || !parsed.success) return [];
    return parsed.data
      .filter((block) => block.kind === "ask" && block.status !== "answered")
      .filter(isApprovalAskBlock)
      .map(
        (block): PendingApproval => ({
          runId: run.id,
          messageId: message.id,
          botId: run.bot.id,
          botName: run.bot.name,
          botColor: run.bot.color,
          groupId: run.thread.group?.id,
          groupName: run.thread.group?.name,
          block,
          createdAt: message.createdAt.toISOString(),
        }),
      );
  });
}
