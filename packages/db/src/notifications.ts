import type { AppNotification, NotificationKind, NotificationList } from "@corvo/contracts";
import { hasMentionToken, personName } from "@corvo/core";
import type { Prisma, PrismaClient } from "./client.js";
import { previewFromBlocks } from "./thread-listing.js";

type Writer = Pick<PrismaClient, "notification">;

/** Most entries the inbox lists; unread ones come first, so a long read tail never hides them. */
const INBOX_PAGE = 60;
const PREVIEW_MAX = 160;
/** How long a push waits, so one the person reads at once is never sent. */
const PUSH_DELAY_MS = 1_500;

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

let pushSink: ((notificationId: string) => void | Promise<void>) | undefined;

/**
 * The delivery path for pushes, set once by the process that owns a push provider. Raising does
 * not wait for it: a push is sent a moment later, only when the entry is still unread.
 */
export function setNotificationPushSink(sink: typeof pushSink): void {
  pushSink = sink;
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
  if (pushSink) {
    const sink = pushSink;
    const timer = setTimeout(() => {
      void Promise.resolve(sink(row.id)).catch(() => undefined);
    }, PUSH_DELAY_MS);
    timer.unref?.();
  }
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

function firstToken(name: string): string | null {
  const token = name.trim().split(/\s+/)[0] ?? "";
  return token.length >= 2 ? token : null;
}

export interface MessageNotificationInput {
  spaceId: string;
  thread: {
    id: string;
    groupId: string | null;
    direct: { userAId: string; userBId: string } | null;
  };
  message: {
    id: string;
    role: string;
    authorUserId: string | null;
    threadRootId: string | null;
    blocks: unknown;
  };
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
  if (!thread.groupId) return;
  const text = blocksText(message.blocks);
  const mayMention = text.includes("@");
  if (!mayMention && !message.threadRootId) return;

  const group = await tx.chatGroup.findUnique({
    where: { id: thread.groupId },
    select: { userId: true, accessRoleIds: true, people: { select: { userId: true } } },
  });
  if (!group) return;
  const restricted = group.people.length > 0 || group.accessRoleIds.length > 0;
  let candidateIds: string[];
  if (restricted) {
    const holders = group.accessRoleIds.length
      ? await tx.spaceMemberRole.findMany({
          where: { spaceId, roleId: { in: group.accessRoleIds } },
          select: { userId: true },
        })
      : [];
    candidateIds = [
      ...new Set([
        group.userId,
        ...group.people.map((p) => p.userId),
        ...holders.map((h) => h.userId),
      ]),
    ];
  } else {
    candidateIds = (
      await tx.spaceMember.findMany({ where: { spaceId }, select: { userId: true } })
    ).map((member) => member.userId);
  }
  candidateIds = candidateIds.filter((id) => id !== author);
  if (candidateIds.length === 0) return;

  const raised = new Set<string>();
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
      if (
        hasMentionToken(text, person.name) ||
        (firstIsUnique && first !== null && hasMentionToken(text, first))
      ) {
        raised.add(person.id);
        await raiseNotification(tx, {
          spaceId,
          userId: person.id,
          kind: "mention",
          dedupeKey: `mention:${message.id}`,
          threadId: thread.id,
          messageId: message.id,
          actorId: author ?? undefined,
        });
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
      source: thread?.group?.name ?? bot?.name ?? actor?.name ?? "",
      actor,
      preview: preview || null,
      detail: row.detail,
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
