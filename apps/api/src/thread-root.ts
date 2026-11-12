import type { Prisma } from "@corvo/db";
import { ORPCError } from "@orpc/server";

/**
 * The message a thread hangs from. A reply's own id resolves to its thread, so a thread is never
 * nested. A root that is not in this channel is refused rather than quietly posted to the main
 * column.
 */
export async function resolveThreadRoot(
  tx: Prisma.TransactionClient,
  threadId: string,
  requestedId: string,
): Promise<{ id: string; botId: string | null; blocks: unknown }> {
  const found = await tx.message.findFirst({
    where: { id: requestedId, threadId },
    select: { id: true, botId: true, blocks: true, threadRootId: true },
  });
  const root = found?.threadRootId
    ? await tx.message.findFirst({
        where: { id: found.threadRootId, threadId },
        select: { id: true, botId: true, blocks: true },
      })
    : found;
  if (!root) throw new ORPCError("BAD_REQUEST", { message: "Thread not found." });
  return root;
}

/**
 * The member a thread message that names nobody is for: whoever answered last in the thread, or
 * the one a hand-off gave the work to, or the author of the root. Undefined when none of them is
 * still a member, which leaves the channel's own choice in place.
 */
export async function threadConversationBot(
  tx: Prisma.TransactionClient,
  threadId: string,
  root: { id: string; botId: string | null; blocks: unknown },
  memberBotIds: readonly string[],
): Promise<string | undefined> {
  const latest = await tx.message.findFirst({
    where: { threadId, threadRootId: root.id, role: "bot", botId: { in: [...memberBotIds] } },
    orderBy: { seq: "desc" },
    select: { botId: true },
  });
  if (latest?.botId) return latest.botId;
  const handoff = Array.isArray(root.blocks)
    ? (root.blocks as Array<{ kind?: string; toBotId?: string }>).find(
        (block) => block?.kind === "handoff",
      )
    : undefined;
  const candidate = handoff?.toBotId ?? root.botId ?? undefined;
  return candidate && memberBotIds.includes(candidate) ? candidate : undefined;
}
