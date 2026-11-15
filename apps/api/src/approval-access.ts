import type { Actor } from "@corvo/contracts";
import { can } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { ApprovalNotAllowedError, IsolationError } from "@corvo/db";
import { ORPCError } from "@orpc/server";
import { getSpaceMembership } from "./space-owner.js";
import { resolveThreadTarget } from "./thread-target.js";

/**
 * The thread an approval card sits in. The agent's owner reaches it as before; anyone else holding
 * `approve_actions` reaches the one thread of that agent or channel in this space. The commit
 * checks again, in the transaction that decides, who may decide.
 */
export async function approvalThreadId(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string },
): Promise<string> {
  try {
    return (await resolveThreadTarget(prisma, actor, input)).threadId;
  } catch (error) {
    if (!(error instanceof IsolationError)) throw error;
    if (!can(await getSpaceMembership(prisma, actor), "approve_actions")) throw error;
    const thread = await prisma.thread.findFirst({
      where: {
        spaceId: actor.spaceId,
        ...(input.botId ? { botId: input.botId } : { groupId: input.groupId ?? "" }),
      },
      select: { id: true },
    });
    if (!thread) throw error;
    return thread.id;
  }
}

/** Maps a refusal from the deciding transaction to the API's. */
export function approvalRefusal(error: unknown): unknown {
  return error instanceof ApprovalNotAllowedError
    ? new ORPCError("FORBIDDEN", { message: error.message })
    : error;
}
