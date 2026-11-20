import type { PrismaClient } from "@corvo/db";

type Db = Pick<PrismaClient, "message" | "run">;

/**
 * Whether `targetBotId` is already answering, or already answered, the message that started the
 * run's chain in its channel: the latest person message at or before the run's source. An agent
 * speaks once per such message, so a handoff or consultation to it is refused and the sender
 * answers itself.
 */
export async function alreadyAnsweringRoot(
  db: Db,
  run: { threadId: string; sourceMessageId?: string | null },
  targetBotId: string,
): Promise<boolean> {
  if (!run.sourceMessageId) return false;
  const source = await db.message.findUnique({
    where: { id: run.sourceMessageId },
    select: { seq: true, threadId: true },
  });
  if (!source || source.threadId !== run.threadId) return false;
  const root = await db.message.findFirst({
    where: { threadId: run.threadId, role: "user", seq: { lte: source.seq } },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  if (!root) return false;
  const prior = await db.run.findFirst({
    where: {
      threadId: run.threadId,
      botId: targetBotId,
      status: { notIn: ["failed", "cancelled"] },
      sourceMessage: { threadId: run.threadId, seq: { gte: root.seq } },
    },
    select: { id: true },
  });
  return Boolean(prior);
}

export function alreadyAnsweringReason(name: string): string {
  return `${name} is already answering this message. Answer it yourself instead of delegating.`;
}
