import { createContext } from "react";
import type { MobileMessage } from "./api";

/** Who is reading the thread, so a teammate's message can say who wrote it. */
export const MessageReaderContext = createContext<string | undefined>(undefined);

/**
 * The name above a user message that someone else wrote in a shared conversation. Your own
 * messages, and older ones that name no author, carry none.
 */
export function messageAuthorLabel(
  message: Pick<MobileMessage, "role" | "authorUserId" | "authorName">,
  readerId: string | undefined,
): string | undefined {
  if (message.role !== "user" || !message.authorName || !message.authorUserId) return undefined;
  return message.authorUserId === readerId ? undefined : message.authorName;
}
