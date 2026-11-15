import * as z from "zod";
import { Id } from "./ids.js";

/**
 * What an inbox entry is about. `alert` is the generic kind for a product-authored line that
 * belongs to no message (a budget limit, a billing notice): any feature may raise one through
 * `raiseNotification` without a new kind or a new screen.
 */
export const NOTIFICATION_KINDS = [
  "mention",
  "reply",
  "dm",
  "approval",
  "question",
  "failure",
  "alert",
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** The most unread messages one conversation counts; the client shows this as "99+". */
export const UNREAD_COUNT_CAP = 100;
export const UNREAD_COUNT_DISPLAY_MAX = 99;

/** "7", or "99+" once it passes what the badge shows. */
export function unreadBadgeText(count: number): string {
  return count > UNREAD_COUNT_DISPLAY_MAX ? `${UNREAD_COUNT_DISPLAY_MAX}+` : String(count);
}

export const NotificationSchema = z.object({
  id: Id,
  kind: NotificationKindSchema,
  threadId: Id.nullable(),
  /** The channel that owns the conversation, when it is one. */
  groupId: Id.nullable(),
  messageId: Id.nullable(),
  botId: Id.nullable(),
  /** Where it happened: the channel, the agent or the person. */
  source: z.string(),
  /** Who caused it, when a person did. */
  actor: z.object({ userId: Id, name: z.string(), image: z.string().nullable() }).nullable(),
  /** The message text, cut short; absent when the entry carries none. */
  preview: z.string().nullable(),
  /** A product-authored line for kinds without a message. */
  detail: z.string().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  unreadCount: z.number().int().nonnegative(),
});
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const PRESENCE_STATUSES = ["online", "away", "offline"] as const;
export const PresenceStatusSchema = z.enum(PRESENCE_STATUSES);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export const PresenceSchema = z.object({
  userId: Id,
  status: PresenceStatusSchema,
  /** When the member was last seen; null when never. */
  lastSeenAt: z.string().nullable(),
});
export type Presence = z.infer<typeof PresenceSchema>;
