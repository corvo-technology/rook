import type {
  MessageBlock,
  ProductEvent,
  ThreadMessage,
  ThreadMessagePage,
} from "@corvo/contracts";
import { MessageBlock as MessageBlockSchema } from "@corvo/contracts";
import {
  BACKGROUND_RUN_TRIGGERS,
  callIdFromClientNonce,
  isBackgroundInputBlock,
  isBackgroundRunTrigger,
  isPeerReceiptBlocks,
} from "@corvo/core";
import { messageReplyPreview } from "@corvo/core/message-quote";
import type { Prisma, PrismaClient } from "@corvo/db";

type MessageDb = PrismaClient | Prisma.TransactionClient;

const replySelection = {
  threadId: true,
  role: true,
  botId: true,
  blocks: true,
} as const;

export async function loadMessagePage(
  prisma: MessageDb,
  threadId: string,
  before: number | undefined,
  pageSize: number,
  around?: { messageId?: string; seq?: number },
  includePeerRuns = false,
  includePeerReceipts = false,
): Promise<ThreadMessagePage> {
  if (around) {
    let targetSeq = around.seq;
    if (targetSeq === undefined && around.messageId) {
      const row = await prisma.message.findFirst({
        where: { id: around.messageId, threadId },
        select: { seq: true },
      });
      targetSeq = row?.seq;
    }
    if (targetSeq !== undefined) {
      const half = Math.floor(pageSize / 2);
      const minSeq = Math.max(0, targetSeq - half);
      const maxSeq = targetSeq + half;
      const rows = await prisma.message.findMany({
        where: { threadId, seq: { gte: minSeq, lte: maxSeq } },
        orderBy: { seq: "asc" },
        take: pageSize,
        include: { replyTo: { select: replySelection } },
      });
      const truncated = rows.length >= pageSize;
      const coveredThroughSeq = truncated ? (rows[rows.length - 1]?.seq ?? maxSeq) : maxSeq;
      const first = rows[0];
      const hasOlder = first
        ? (await prisma.message.count({ where: { threadId, seq: { lt: first.seq } } })) > 0
        : false;
      // Peer activity stays out of the normal transcript (including the
      // around target). Full peer history belongs in the bot-messages overlay
      // (includePeerRuns).
      const messages = includePeerRuns ? rows : await withoutPeerRunMessages(prisma, rows);
      return {
        threadId,
        messages: await withRoutineNames(prisma, messages),
        olderCursor: hasOlder ? (first?.seq ?? null) : null,
        coveredThroughSeq,
      };
    }
  }

  let cursor = before;
  while (true) {
    const rows = await prisma.message.findMany({
      where: {
        threadId,
        ...(cursor === undefined ? {} : { seq: { lt: cursor } }),
      },
      orderBy: { seq: "desc" },
      take: pageSize + 1,
      include: { replyTo: { select: replySelection } },
    });
    const hasOlder = rows.length > pageSize;
    const pageRows = rows.slice(0, pageSize).reverse();
    const visibleRows = includePeerRuns ? pageRows : await withoutPeerRunMessages(prisma, pageRows);
    // Web hides receipts client-side, so its receipt-only pages keep scanning.
    // Mobile explicitly retains them and must receive each page for pagination.
    const hasSubstantive = visibleRows.some(
      (row) => !isPeerReceiptBlocks(row.blocks as MessageBlock[]),
    );
    if (hasSubstantive || includePeerReceipts || !hasOlder || includePeerRuns) {
      return {
        threadId,
        messages: await withRoutineNames(prisma, visibleRows),
        olderCursor: hasOlder ? (pageRows[0]?.seq ?? null) : null,
      };
    }
    // TODO: only rescan when a raw page is entirely peer output. Consider a run relation if
    // long peer-only histories make this path hot.
    cursor = pageRows[0]?.seq;
  }
}

/** The messages as the thread shows them, each written by a routine's run naming that routine. */
export async function withRoutineNames(
  prisma: MessageDb,
  rows: Parameters<typeof toThreadMessage>[0][],
): Promise<ThreadMessage[]> {
  const runIds = [...new Set(rows.flatMap((row) => (row.runId ? [row.runId] : [])))];
  const runs = runIds.length
    ? await prisma.run.findMany({
        where: { id: { in: runIds }, routineId: { not: null } },
        select: { id: true, routine: { select: { name: true } } },
      })
    : [];
  const names = new Map(runs.flatMap((run) => (run.routine ? [[run.id, run.routine.name]] : [])));
  // Older rows name no author and show as before.
  const authorIds = [
    ...new Set(rows.flatMap((row) => (row.authorUserId ? [row.authorUserId] : []))),
  ];
  const users = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true, image: true },
      })
    : [];
  const authors = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) =>
    toThreadMessage({
      ...row,
      routineName: row.runId ? names.get(row.runId) : undefined,
      author: row.authorUserId ? authors.get(row.authorUserId) : undefined,
    }),
  );
}

export async function loadAllMessages(
  prisma: PrismaClient,
  threadId: string,
  pageSize: number,
): Promise<ThreadMessage[]> {
  const pages: ThreadMessage[][] = [];
  let before: number | undefined;
  do {
    const page = await loadMessagePage(prisma, threadId, before, pageSize, undefined, true);
    pages.push(page.messages);
    before = page.olderCursor ?? undefined;
  } while (before !== undefined);
  return pages.reverse().flat();
}

async function withoutPeerRunMessages<
  T extends {
    runId: string | null;
    blocks: Prisma.JsonValue;
  },
>(prisma: MessageDb, rows: T[]): Promise<T[]> {
  const runIds = [...new Set(rows.flatMap((row) => (row.runId ? [row.runId] : [])))];
  if (runIds.length === 0) return rows;
  const runs = await prisma.run.findMany({
    where: {
      id: { in: runIds },
      trigger: { in: ["bot_message", ...BACKGROUND_RUN_TRIGGERS] },
    },
    select: { id: true, trigger: true },
  });
  const backgroundRunIds = new Set(
    runs.filter((run) => isBackgroundRunTrigger(run.trigger)).map((r) => r.id),
  );
  const peerRunIds = new Set(
    runs.filter((run) => !backgroundRunIds.has(run.id)).map((run) => run.id),
  );
  return rows.filter((row) => {
    if (!row.runId) return true;
    const blocks = row.blocks as MessageBlock[];
    if (backgroundRunIds.has(row.runId)) {
      // Ticket work stays off the transcript except existing user-input cards.
      return blocks.some(isBackgroundInputBlock);
    }
    if (!peerRunIds.has(row.runId)) return true;
    // Keep peer receipts (chips), ask cards, and the bot's own text or attachment reply.
    return blocks.some(
      (block) =>
        block.kind === "bot_message_sent" ||
        block.kind === "bot_message_received" ||
        block.kind === "ask" ||
        block.kind === "text" ||
        block.kind === "file" ||
        block.kind === "image",
    );
  });
}

export async function isPeerRun(
  prisma: MessageDb,
  runId: string | undefined,
  cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  if (!runId) return false;
  let peerRun = cache.get(runId);
  if (!peerRun) {
    peerRun = prisma.run
      .findUnique({ where: { id: runId }, select: { trigger: true } })
      .then((run) => run?.trigger === "bot_message");
    cache.set(runId, peerRun);
  }
  return peerRun;
}

/** A live message event with the routine behind its run named, so the badge shows without a reload. */
export async function withEventRoutineName<
  E extends { type: string; runId?: string; payload: Record<string, unknown> },
>(prisma: MessageDb, event: E, cache: Map<string, Promise<string | undefined>>): Promise<E> {
  if (!event.runId || event.type !== "thread.message.created") return event;
  let name = cache.get(event.runId);
  if (!name) {
    name = prisma.run
      .findUnique({ where: { id: event.runId }, select: { routine: { select: { name: true } } } })
      .then((run) => run?.routine?.name);
    cache.set(event.runId, name);
  }
  const routineName = await name;
  return routineName ? { ...event, payload: { ...event.payload, routineName } } : event;
}

export async function isBackgroundRun(
  prisma: MessageDb,
  runId: string | undefined,
  cache: Map<string, Promise<boolean>>,
): Promise<boolean> {
  if (!runId) return false;
  let backgroundRun = cache.get(runId);
  if (!backgroundRun) {
    backgroundRun = prisma.run
      .findUnique({ where: { id: runId }, select: { trigger: true } })
      .then((run) => isBackgroundRunTrigger(run?.trigger));
    cache.set(runId, backgroundRun);
  }
  return backgroundRun;
}

/** Peer-run SSE events that must still reach an open thread (terminals, waits, receipts, asks, text, attachments). */
export function shouldForwardPeerThreadEvent(event: {
  type: string;
  payload: { blocks?: unknown };
}): boolean {
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    event.type === "run.waiting_input" ||
    event.type === "computer.takeover.requested"
  ) {
    return true;
  }
  if (event.type !== "thread.message.created" && event.type !== "thread.message.updated") {
    return false;
  }
  const blocks = event.payload.blocks;
  return (
    Array.isArray(blocks) &&
    blocks.some(
      (block) =>
        !!block &&
        typeof block === "object" &&
        "kind" in block &&
        (block.kind === "bot_message_received" ||
          block.kind === "bot_message_sent" ||
          block.kind === "ask" ||
          block.kind === "text" ||
          block.kind === "file" ||
          block.kind === "image"),
    )
  );
}

/**
 * A background run's chatter stays off the transcript: no starts, progress, steps,
 * or final text. An open thread still receives the state it needs to answer without
 * a reload — waiting input, computer takeover, and terminal run events — plus the
 * existing user-input cards.
 */
export function shouldForwardBackgroundThreadEvent(event: {
  type: string;
  payload: { blocks?: unknown };
}): boolean {
  if (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.cancelled" ||
    event.type === "run.waiting_input" ||
    event.type === "computer.takeover.requested"
  ) {
    return true;
  }
  if (event.type !== "thread.message.created" && event.type !== "thread.message.updated") {
    return false;
  }
  const blocks = event.payload.blocks;
  return Array.isArray(blocks) && blocks.some(isBackgroundInputBlock);
}

export function toThreadMessage(row: {
  id: string;
  threadId: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
  botId: string | null;
  replyToMessageId: string | null;
  replyQuote: string | null;
  threadRootId?: string | null;
  replyTo?: {
    threadId: string;
    role: string;
    botId: string | null;
    blocks: Prisma.JsonValue;
  } | null;
  runId: string | null;
  clientNonce?: string | null;
  pinnedAt?: Date | null;
  routineName?: string;
  /** Who wrote a user message, when it names an author; resolved by `withRoutineNames`. */
  authorUserId?: string | null;
  author?: { id: string; name: string; image: string | null };
  createdAt: Date;
}): ThreadMessage {
  const parent = row.replyTo?.threadId === row.threadId ? row.replyTo : null;
  const parsed = parent ? MessageBlockSchema.array().safeParse(parent.blocks) : undefined;
  const replyPreview =
    parent && parsed?.success
      ? messageReplyPreview(
          parsed.data,
          parent.role as ThreadMessage["role"],
          parent.botId ?? undefined,
        )
      : row.replyToMessageId || row.replyQuote != null
        ? null
        : undefined;
  return {
    id: row.id,
    threadId: row.threadId,
    seq: row.seq,
    role: row.role as ThreadMessage["role"],
    blocks: row.blocks as ThreadMessage["blocks"],
    botId: row.botId ?? undefined,
    replyToMessageId: row.replyToMessageId ?? undefined,
    replyQuote: row.replyQuote ?? undefined,
    replyPreview,
    threadRootId: row.threadRootId ?? undefined,
    runId: row.runId ?? undefined,
    callId: callIdFromClientNonce(row.clientNonce),
    routineName: row.routineName,
    ...(row.author
      ? {
          authorUserId: row.author.id,
          authorName: row.author.name,
          authorImage: row.author.image,
        }
      : {}),
    pinnedAt: row.pinnedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A live user message names its author by id only; the stream adds their name and picture, so a
 * teammate's message arrives with the same label a page load would give it.
 */
export async function withAuthor<E extends ProductEvent>(
  prisma: MessageDb,
  event: E,
  cache: Map<string, Promise<{ name: string; image: string | null } | null>>,
): Promise<E> {
  const authorUserId = event.payload.authorUserId;
  if (event.type !== "thread.message.created" || typeof authorUserId !== "string") return event;
  let author = cache.get(authorUserId);
  if (!author) {
    author = prisma.user.findUnique({
      where: { id: authorUserId },
      select: { name: true, image: true },
    });
    cache.set(authorUserId, author);
  }
  const found = await author;
  return found
    ? { ...event, payload: { ...event.payload, authorName: found.name, authorImage: found.image } }
    : event;
}
