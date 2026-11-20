import type { AppNotification, NotificationKind, NotificationList } from "@corvo/contracts";
import { NotificationCodeSchema } from "@corvo/contracts";
import { hasMentionToken, personName } from "@corvo/core";
import type { Prisma, PrismaClient } from "./client.js";
import { conversationAudienceUserIds } from "./conversation-audience.js";
import { previewFromBlocks } from "./thread-listing.js";

type Writer = Pick<PrismaClient, "notification">;

/** Most entries the inbox lists; unread ones come first, so a long read tail never hides them. */
const INBOX_PAGE = 60;
const PREVIEW_MAX = 160;
export interface RaiseNotificationInput {
  spaceId: string;
  userId: string;
  kind: NotificationKind;
  /** One live entry per source: raising the same key again refreshes it and makes it unread. */
  dedupeKey: string;
  threadId?: string;
  messageId?: string;
  botId?: string;
  actorId?: string;
  /** A short line the product wrote, for an entry that has no message. Never user content. */
  detail?: string;
}

/**
 * Raises one inbox entry for one member. Any feature may call this with `kind: "alert"` and a
 * `detail` (a budget limit, a billing notice) and it shows in the inbox with no further work.
 */
export async function raiseNotification(
  client: Writer,
  input: RaiseNotificationInput,
): Promise<string> {
  const fields = {
    kind: input.kind,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    botId: input.botId ?? null,
    actorId: input.actorId ?? null,
    detail: input.detail ?? null,
  };
  const row = await client.notification.upsert({
    where: { userId_dedupeKey: { userId: input.userId, dedupeKey: input.dedupeKey } },
    create: { spaceId: input.spaceId, userId: input.userId, dedupeKey: input.dedupeKey, ...fields },
    update: { ...fields, readAt: null, createdAt: new Date() },
    select: { id: true },
  });
  return row.id;
}

function blocksText(blocks: unknown): string {
  return (Array.isArray(blocks) ? blocks : [])
    .map((block) =>
      block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string"
        ? (block as { text: string }).text
        : "",
    )
    .join("\n");
}

async function raiseMention(
  tx: Prisma.TransactionClient,
  input: MessageNotificationInput,
  userId: string,
): Promise<void> {
  await raiseNotification(tx, {
    spaceId: input.spaceId,
    userId,
    kind: "mention",
    dedupeKey: `mention:${input.message.id}`,
    threadId: input.thread.id,
    messageId: input.message.id,
    botId: input.thread.groupId ? undefined : (input.thread.botId ?? undefined),
    actorId: input.message.authorUserId ?? undefined,
  });
}

/** A chosen mention in an agent's own conversation: told only if the person reads that chat. */
async function raiseChosenMentions(
  tx: Prisma.TransactionClient,
  input: MessageNotificationInput,
  botId: string,
): Promise<void> {
  const audience = new Set(await conversationAudienceUserIds(tx, input.spaceId, { botId }));
  for (const userId of new Set(input.mentionedUserIds ?? [])) {
    if (userId === input.message.authorUserId || !audience.has(userId)) continue;
    await raiseMention(tx, input, userId);
  }
}

function firstToken(name: string): string | null {
  const token = name.trim().split(/\s+/)[0] ?? "";
  return token.length >= 2 ? token : null;
}

export interface MessageNotificationInput {
  spaceId: string;
  thread: {
    id: string;
    groupId: string | null;
    botId?: string | null;
    direct: { userAId: string; userBId: string } | null;
  };
  message: {
    id: string;
    role: string;
    authorUserId: string | null;
    threadRootId: string | null;
    blocks: unknown;
  };
  /** People the sender picked with a mention chip; only those who can see the conversation are told. */
  mentionedUserIds?: readonly string[];
}

/**
 * Raises the inbox entries a new message earns inside its transaction: a DM for the other person,
 * a mention for each person it names in a channel, a reply for those already in a channel thread.
 * Chats with one agent raise nothing here: their unread count is the signal.
 */
export async function notifyForMessage(
  tx: Prisma.TransactionClient,
  input: MessageNotificationInput,
): Promise<void> {
  const { thread, message, spaceId } = input;
  if (message.role !== "user" && message.role !== "bot") return;
  const author = message.authorUserId;
  if (thread.direct) {
    const partner =
      author === thread.direct.userAId
        ? thread.direct.userBId
        : author === thread.direct.userBId
          ? thread.direct.userAId
          : null;
    if (!partner) return;
    await raiseNotification(tx, {
      spaceId,
      userId: partner,
      kind: "dm",
      dedupeKey: `dm:${thread.id}`,
      threadId: thread.id,
      messageId: message.id,
      actorId: author ?? undefined,
    });
    return;
  }
  const chosen = input.mentionedUserIds ?? [];
  if (!thread.groupId) {
    if (!thread.botId || chosen.length === 0) return;
    await raiseChosenMentions(tx, input, thread.botId);
    return;
  }
  const text = blocksText(message.blocks);
  const mayMention = text.includes("@");
  if (!mayMention && !message.threadRootId && chosen.length === 0) return;

  const audience = await conversationAudienceUserIds(tx, spaceId, { groupId: thread.groupId });
  const candidateIds = audience.filter((id) => id !== author);
  if (candidateIds.length === 0) return;

  const raised = new Set<string>();
  for (const userId of chosen) {
    if (!candidateIds.includes(userId)) continue;
    raised.add(userId);
    await raiseMention(tx, input, userId);
  }
  if (mayMention) {
    const users = await tx.user.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, name: true, email: true },
    });
    const names = users.map((user) => ({ id: user.id, name: personName(user.name, user.email) }));
    for (const person of names) {
      const first = firstToken(person.name);
      const firstIsUnique =
        first !== null &&
        names.filter((other) => firstToken(other.name)?.toLowerCase() === first.toLowerCase())
          .length === 1;
      if (raised.has(person.id)) continue;
      if (
        hasMentionToken(text, person.name) ||
        (firstIsUnique && first !== null && hasMentionToken(text, first))
      ) {
        raised.add(person.id);
        await raiseMention(tx, input, person.id);
      }
    }
  }
  if (message.threadRootId) {
    const [root, replies] = await Promise.all([
      tx.message.findUnique({
        where: { id: message.threadRootId },
        select: { authorUserId: true },
      }),
      tx.message.findMany({
        where: { threadId: thread.id, threadRootId: message.threadRootId },
        distinct: ["authorUserId"],
        select: { authorUserId: true },
      }),
    ]);
    const inThread = new Set(
      [root?.authorUserId, ...replies.map((reply) => reply.authorUserId)].filter(
        (id): id is string => Boolean(id) && candidateIds.includes(id as string),
      ),
    );
    for (const userId of inThread) {
      if (raised.has(userId)) continue;
      await raiseNotification(tx, {
        spaceId,
        userId,
        kind: "reply",
        dedupeKey: `reply:${message.threadRootId}`,
        threadId: thread.id,
        messageId: message.id,
        actorId: author ?? undefined,
      });
    }
  }
}

function cut(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1).trimEnd()}…` : text;
}

/** The member's inbox in one space: unread first, newest first, with the text read from the message. */
export async function listNotifications(
  prisma: Pick<PrismaClient, "notification" | "thread" | "message" | "user" | "bot">,
  input: { spaceId: string; userId: string },
): Promise<NotificationList> {
  const where = { spaceId: input.spaceId, userId: input.userId };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
      take: INBOX_PAGE,
    }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { items: await describeNotifications(prisma, input.spaceId, rows), unreadCount };
}

type DescribeClient = Pick<PrismaClient, "thread" | "message" | "user" | "bot">;
type NotificationRow = Prisma.NotificationGetPayload<object>;

/** Gives entries the words they show: where it happened, who did it, and the message text. */
export async function describeNotifications(
  prisma: DescribeClient,
  spaceId: string,
  rows: readonly NotificationRow[],
): Promise<AppNotification[]> {
  const ids = <T>(values: Array<T | null>): T[] => [
    ...new Set(values.filter((value): value is T => value !== null)),
  ];
  const [threads, messages, users, bots] = await Promise.all([
    prisma.thread.findMany({
      where: { id: { in: ids(rows.map((row) => row.threadId)) }, spaceId },
      select: { id: true, groupId: true, group: { select: { name: true } } },
    }),
    prisma.message.findMany({
      where: { id: { in: ids(rows.map((row) => row.messageId)) } },
      select: { id: true, blocks: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ids(rows.map((row) => row.actorId)) } },
      select: { id: true, name: true, email: true, image: true },
    }),
    prisma.bot.findMany({
      where: { id: { in: ids(rows.map((row) => row.botId)) }, spaceId },
      select: { id: true, name: true },
    }),
  ]);
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  return rows.map((row): AppNotification => {
    const thread = row.threadId ? threadById.get(row.threadId) : undefined;
    const person = row.actorId ? userById.get(row.actorId) : undefined;
    const actor = person
      ? { userId: person.id, name: personName(person.name, person.email), image: person.image }
      : null;
    const bot = row.botId ? botById.get(row.botId) : undefined;
    const message = row.messageId ? messageById.get(row.messageId) : undefined;
    const preview = message ? cut(previewFromBlocks(message.blocks)) : "";
    return {
      id: row.id,
      kind: row.kind as NotificationKind,
      threadId: row.threadId,
      groupId: thread?.groupId ?? null,
      messageId: row.messageId,
      botId: row.botId,
      source:
        thread?.group?.name ?? bot?.name ?? actor?.name ?? asParams(row.params)?.partner ?? "",
      actor,
      preview: preview || null,
      detail: row.detail,
      code: NotificationCodeSchema.safeParse(row.code).data ?? null,
      params: asParams(row.params),
      read: row.readAt !== null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Marks entries read: the named ones, or every one of a conversation, or both together. */
export async function markNotificationsRead(
  client: Writer,
  input: { spaceId: string; userId: string; ids?: string[]; threadId?: string },
): Promise<void> {
  await client.notification.updateMany({
    where: {
      spaceId: input.spaceId,
      userId: input.userId,
      readAt: null,
      ...(input.ids ? { id: { in: input.ids } } : {}),
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(
  client: Writer,
  input: { spaceId: string; userId: string },
): Promise<void> {
  await markNotificationsRead(client, input);
}

function asParams(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
