import type { ThreadMessage } from "@corvo/contracts";

/** How many faces a thread footer shows. */
const THREAD_FACES = 3;

export type PeerThreadSummary = {
  /** Replies folded under the marker; reactions to them do not count. */
  count: number;
  /** The agents who replied, in the order they first did. */
  botIds: string[];
  /** When the last reply was sent. */
  lastAt: string;
};

/** What a folded peer exchange shows while closed: its reply count, who replied and when last. */
export function peerThreadSummary(
  folded: readonly Pick<ThreadMessage, "role" | "botId" | "createdAt">[] | undefined,
): PeerThreadSummary | undefined {
  const replies = (folded ?? []).filter((message) => message.role === "bot");
  const last = replies.at(-1);
  if (!last) return undefined;
  const botIds = [
    ...new Set(replies.flatMap((message) => (message.botId ? [message.botId] : []))),
  ].slice(0, THREAD_FACES);
  return { count: replies.length, botIds, lastAt: last.createdAt };
}
