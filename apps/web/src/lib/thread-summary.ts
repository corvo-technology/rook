import type { ThreadMessage } from "@corvo/contracts";
import { messageReaction } from "@corvo/core";

/** How many faces a thread footer shows. */
const THREAD_FACES = 3;

export type ThreadSummary = {
  /** Replies in the thread; reactions and live drafts do not count. */
  count: number;
  /** The agents who replied, in the order they first did. */
  botIds: string[];
  /** When the last reply was sent. */
  lastAt: string;
};

type Reply = Pick<ThreadMessage, "id" | "role" | "botId" | "createdAt" | "blocks"> & {
  replyToMessageId?: string | null;
};

/** What a thread shows under its root: how many replied, which agents and when last. */
export function threadSummary(replies: readonly Reply[] | undefined): ThreadSummary | undefined {
  const sent = (replies ?? []).filter(
    (reply) =>
      !reply.id.startsWith("progress:") &&
      !reply.id.startsWith("subagent:") &&
      !messageReaction(reply),
  );
  const last = sent.at(-1);
  if (!last) return undefined;
  const botIds = [
    ...new Set(sent.flatMap((reply) => (reply.role === "bot" && reply.botId ? [reply.botId] : []))),
  ].slice(0, THREAD_FACES);
  return { count: sent.length, botIds, lastAt: last.createdAt };
}
