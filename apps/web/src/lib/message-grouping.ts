import type { ThreadMessage } from "@corvo/contracts";
import { isPeerReceiptBlocks } from "@corvo/core";

/** Messages from the same agent this close together read as one, as they do in a chat room. */
export const SAME_SPEAKER_WINDOW_MS = 5 * 60_000;

type Spoken = Pick<ThreadMessage, "id" | "role" | "botId" | "createdAt" | "blocks">;

/** Who said a message, or null when it never groups (a hand-off receipt, a system line). */
function speakerOf(message: Spoken, people: boolean): string | null {
  if (isPeerReceiptBlocks(message.blocks)) return null;
  if (message.role === "bot") return message.botId ? `bot:${message.botId}` : null;
  return people && message.role === "user" ? "person" : null;
}

/**
 * The messages that carry on from the one before: the same speaker again within a few minutes,
 * with nothing between them (a day marker, the unread line, someone else, a hand-off receipt).
 * They show no name or face of their own. The person's messages group too when `people` is set,
 * as in a channel where everyone sits in one column.
 */
export function continuedMessageIds(
  messages: readonly Spoken[],
  breaks: (messageId: string) => boolean,
  { people = false }: { people?: boolean } = {},
): Set<string> {
  const continued = new Set<string>();
  let previous = null as { speaker: string; at: number } | null;
  for (const message of messages) {
    const speaker = speakerOf(message, people);
    const at = new Date(message.createdAt).getTime();
    if (
      speaker &&
      previous?.speaker === speaker &&
      !breaks(message.id) &&
      at - previous.at < SAME_SPEAKER_WINDOW_MS
    ) {
      continued.add(message.id);
    }
    previous = speaker ? { speaker, at } : null;
  }
  return continued;
}
