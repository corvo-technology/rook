import * as z from "zod";
import { UnreadCountsSchema } from "./domain.js";
import { MessageBlock } from "./events.js";
import { Id, IsoDate } from "./ids.js";

/** Who sees a channel. An open channel lists no one: it is the whole space. */
export const ChannelPeopleSchema = z.object({
  restricted: z.boolean(),
  userIds: z.array(Id),
  /** The roles whose holders see the channel. */
  roleIds: z.array(Id).default([]),
  /** Whether the caller may add and remove people: the creator, or someone who manages channels. */
  canManage: z.boolean(),
});
export type ChannelPeople = z.infer<typeof ChannelPeopleSchema>;

/** One agent's approval waiting on the caller, with the card that decides it. */
export const PendingApprovalSchema = z.object({
  runId: Id,
  messageId: Id,
  botId: Id,
  botName: z.string(),
  botColor: z.string(),
  /** The channel it sits in; absent in the agent's own chat. */
  groupId: Id.optional(),
  groupName: z.string().optional(),
  block: MessageBlock,
  createdAt: IsoDate,
});
export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

/** A member of the space as the "People" list shows them, with the conversation they share. */
export const DirectPersonSchema = z.object({
  userId: Id,
  name: z.string(),
  image: z.string().nullable(),
  threadId: Id.nullable(),
  unread: z.boolean(),
  ...UnreadCountsSchema.shape,
});
export type DirectPerson = z.infer<typeof DirectPersonSchema>;

export const DIRECT_MESSAGE_MAX_LENGTH = 8000;
