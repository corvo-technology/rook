import type { TicketField, TicketStatus } from "@corvo/contracts";
import {
  CommentTicketInput,
  CreateTicketInput,
  isTicketCompletedStatus,
  mergeTicketFields,
  TICKET_TODO_PER_OWNER_MAX,
  TicketStatusSchema,
  ticketRef,
  UpdateTicketInput,
} from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  allocateTicketNumber,
  coerceTicketStatus,
  ensureBoard,
  findTicket,
  listTicketComments,
  readTicketFields,
  toBoardDto,
  toTicketCommentDto,
  toTicketDto,
} from "@corvo/db";
import type { TicketChangeNotifier } from "./ticket-changes.js";

type TicketToolDeps = {
  prisma: PrismaClient;
  ticketBoardEnabled?: boolean;
  onTicketChange?: TicketChangeNotifier;
};

function ticketInputError(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues
    .map(({ path, message }) => {
      const field =
        path[0] === "assigneeBotId" ? "ownerBotId" : path[0] === "ticketId" ? "id" : path.join(".");
      return field ? `${field}: ${message}` : message;
    })
    .join("; ");
}

function mergeFieldsOrThrow(current: TicketField[], patch: Record<string, string>) {
  try {
    return mergeTicketFields(current, patch);
  } catch (cause) {
    throw new FieldLimitError(cause instanceof Error ? cause.message : "Too many fields.");
  }
}

/** A field change that would leave the ticket with more fields than it may hold. */
class FieldLimitError extends Error {}

const STATUS_ERROR = `status must be one of ${TicketStatusSchema.options.join(", ")}.`;
function coerceInputStatus(value: string) {
  const parsed = TicketStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
/**
 * An assignee must be one of the acting user's own bots, as the HTTP API
 * requires through `repos.getBot`. Assigning wakes the bot, which runs as its
 * owner, so another member's bot in the same space is not a valid target.
 */
async function ownBotInSpace(
  deps: TicketToolDeps,
  input: { spaceId: string; userId: string },
  botId: string,
) {
  return Boolean(
    await deps.prisma.bot.findFirst({
      where: { id: botId, spaceId: input.spaceId, userId: input.userId, archivedAt: null },
      select: { id: true },
    }),
  );
}
/** Who made a change: the acting bot, or else the person. */
async function moverOf(
  deps: TicketToolDeps,
  input: { spaceId: string; userId: string; botId?: string },
): Promise<{ byBotId: string | null; byName: string | null }> {
  if (input.botId) {
    const bot = await deps.prisma.bot.findFirst({
      where: { id: input.botId, spaceId: input.spaceId },
      select: { name: true },
    });
    return { byBotId: input.botId, byName: bot?.name ?? null };
  }
  const user = await deps.prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true },
  });
  return { byBotId: null, byName: user?.name ?? null };
}

type BoardRow = Awaited<ReturnType<typeof ensureBoard>>;

/** Resolves refs (RAK-4) or ids to tickets of this board; an unknown one is an error. */
async function resolveBlockers(
  deps: TicketToolDeps,
  spaceId: string,
  board: BoardRow,
  refs: string[],
): Promise<{ ids: string[] } | { error: string }> {
  const ids: string[] = [];
  for (const ref of refs) {
    const row =
      (await findTicket(deps.prisma, spaceId, board, { ref })) ??
      (await findTicket(deps.prisma, spaceId, board, { id: ref }));
    if (!row) return { error: `blockedBy: ticket ${ref} not found.` };
    if (!ids.includes(row.id)) ids.push(row.id);
  }
  return { ids };
}

/** True when `target` is reachable by following blockers from `from`, which would make a cycle. */
async function waitsOn(deps: TicketToolDeps, from: string[], target: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = from;
  while (frontier.length > 0 && seen.size < 500) {
    if (frontier.includes(target)) return true;
    for (const id of frontier) seen.add(id);
    const next = await deps.prisma.ticketDependency.findMany({
      where: { ticketId: { in: frontier } },
      select: { blockerId: true },
    });
    frontier = next.map((row) => row.blockerId).filter((id) => !seen.has(id));
  }
  return false;
}

/** The ticket as an agent reads it: the board's fields plus what gates and finishes it. */
async function agentTicket(
  deps: TicketToolDeps,
  row: Parameters<typeof toTicketDto>[0] & {
    acceptanceCriteria?: string | null;
    remaining?: string | null;
  },
  prefix: string,
) {
  const blockers = await deps.prisma.ticketDependency.findMany({
    where: { ticketId: row.id },
    select: { blocker: { select: { number: true, status: true } } },
  });
  return {
    ...toTicketDto(row, prefix),
    ...(row.acceptanceCriteria ? { acceptanceCriteria: row.acceptanceCriteria } : {}),
    ...(row.remaining ? { remaining: row.remaining } : {}),
    ...(blockers.length > 0
      ? {
          blockedBy: blockers.map(({ blocker }) => ({
            ref: ticketRef(prefix, blocker.number),
            status: blocker.status,
          })),
        }
      : {}),
  };
}

const LIST_TICKETS_LIMIT = 50;
const LIST_DESCRIPTION_CHARS = 200;

/**
 * The page key is the ticket's `createdAt` with `id` as the tiebreaker, because
 * both never change. A key on `updatedAt` would move a ticket that is edited
 * while a bot pages the board: the ticket would end up above the saved cursor
 * and no later page could return it. A stable key keeps the scan complete.
 */
function encodeTicketListCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

function decodeTicketListCursor(
  cursor: string,
): { createdAt: Date; id: string } | { error: string } {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return { error: "cursor is invalid." };
  }
  const split = raw.indexOf("|");
  if (split <= 0) return { error: "cursor is invalid." };
  const createdAt = new Date(raw.slice(0, split));
  const id = raw.slice(split + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return { error: "cursor is invalid." };
  return { createdAt, id };
}

function truncateDescription(value: string | null | undefined) {
  if (!value || value.length <= LIST_DESCRIPTION_CHARS) return value;
  return `${value.slice(0, LIST_DESCRIPTION_CHARS - 1)}…`;
}

export async function listBoardTickets(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    status?: string;
    assigneeBotId?: string;
    cursor?: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  let status: TicketStatus | undefined;
  if (input.status !== undefined) {
    status = coerceInputStatus(input.status);
    if (!status) return { error: STATUS_ERROR };
  }
  const cursor = input.cursor?.trim();
  let pageCursor: { createdAt: Date; id: string } | undefined;
  if (cursor) {
    const decoded = decodeTicketListCursor(cursor);
    if ("error" in decoded) return decoded;
    pageCursor = decoded;
  }
  const board = await ensureBoard(deps.prisma, input.spaceId);
  const rows = await deps.prisma.ticket.findMany({
    where: {
      spaceId: input.spaceId,
      boardId: board.id,
      // Closed tickets are history; they only show up when asked for by status.
      ...(status ? { status } : { status: { not: "closed" } }),
      ...(input.assigneeBotId ? { assigneeBotId: input.assigneeBotId } : {}),
      ...(pageCursor
        ? {
            OR: [
              { createdAt: { lt: pageCursor.createdAt } },
              { createdAt: pageCursor.createdAt, id: { lt: pageCursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: LIST_TICKETS_LIMIT + 1,
  });
  const page = rows.slice(0, LIST_TICKETS_LIMIT);
  const next = rows.length > LIST_TICKETS_LIMIT ? page.at(-1) : undefined;
  const statusLabels = toBoardDto(board).statusLabels;
  // A list is for scanning; ticket_get returns the full description.
  return {
    // The person's own column names, so the agent can speak the way the board does.
    ...(Object.keys(statusLabels).length > 0 ? { statusLabels } : {}),
    tickets: page.map((row) => {
      const dto = toTicketDto(row, board.ticketPrefix);
      return { ...dto, description: truncateDescription(dto.description) };
    }),
    ...(next ? { nextCursor: encodeTicketListCursor(next) } : {}),
  };
}

export async function getTicket(deps: TicketToolDeps, input: { spaceId: string; ref: string }) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const ref = input.ref.trim();
  if (!ref) return { error: "ref is required." };
  const board = await ensureBoard(deps.prisma, input.spaceId);
  const row =
    (await findTicket(deps.prisma, input.spaceId, board, { ref })) ??
    (await findTicket(deps.prisma, input.spaceId, board, { id: ref }));
  if (!row) return { error: `Ticket ${ref} not found.` };
  const comments = await listTicketComments(deps.prisma, input.spaceId, row.id);
  return {
    ticket: await agentTicket(deps, row, board.ticketPrefix),
    comments: comments.map(toTicketCommentDto),
  };
}

export async function createTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId: string;
    title: string;
    description?: string;
    priority?: string;
    ownerBotId?: string;
    acceptanceCriteria?: string;
    blockedBy?: string[];
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = CreateTicketInput.safeParse({
    ...input,
    assigneeBotId: input.ownerBotId ?? input.botId,
  });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const data = parsed.data;
  if (!(await ownBotInSpace(deps, input, data.assigneeBotId))) return { error: "Unknown bot." };
  const board = await ensureBoard(deps.prisma, input.spaceId);
  const blockers = await resolveBlockers(deps, input.spaceId, board, data.blockedBy ?? []);
  if ("error" in blockers) return blockers;
  if (input.botId) {
    // An agent files one ticket per deliverable: the same one twice, or a pile of them for one
    // owner, is a list that belongs in a single ticket.
    const mine = {
      boardId: board.id,
      createdByBotId: input.botId,
      assigneeBotId: data.assigneeBotId,
    };
    const same = await deps.prisma.ticket.findFirst({
      where: {
        ...mine,
        status: { in: ["todo", "doing", "review", "blocked"] },
        title: { equals: data.title, mode: "insensitive" },
      },
    });
    if (same) return { ticket: await agentTicket(deps, same, board.ticketPrefix), existing: true };
    const waiting = await deps.prisma.ticket.count({ where: { ...mine, status: "todo" } });
    if (waiting >= TICKET_TODO_PER_OWNER_MAX) {
      return {
        error: `${waiting} tickets you created for this owner are still waiting. Put the rest in the checklist of one ticket (acceptanceCriteria or description) instead of one ticket per item.`,
      };
    }
  }
  const row = await deps.prisma.$transaction(async (tx) => {
    const number = await allocateTicketNumber(tx, board.id);
    const created = await tx.ticket.create({
      data: {
        acceptanceCriteria: data.acceptanceCriteria || null,
        boardId: board.id,
        spaceId: input.spaceId,
        number,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        assigneeBotId: data.assigneeBotId,
        createdByBotId: input.botId ?? null,
        createdByUserId: input.userId,
        sweepEligibleAt: new Date(),
      },
    });
    if (blockers.ids.length > 0) {
      await tx.ticketDependency.createMany({
        data: blockers.ids.map((blockerId) => ({ ticketId: created.id, blockerId })),
      });
    }
    return created;
  });
  // A ticket that waits on others is woken by the last of them finishing, not now.
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: board.id,
    ticketId: row.id,
    assigneeBotId: row.assigneeBotId,
    wakeAssignee: row.assigneeBotId !== input.botId,
  });
  return { ticket: await agentTicket(deps, row, board.ticketPrefix) };
}

export async function updateTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId: string;
    id: string;
    title?: string;
    description?: string | null;
    priority?: string | null;
    status?: string;
    ownerBotId?: string;
    fields?: Record<string, string>;
    acceptanceCriteria?: string | null;
    blockedBy?: string[];
    remaining?: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = UpdateTicketInput.safeParse({ ...input, assigneeBotId: input.ownerBotId });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const data = parsed.data;
  if (data.remaining && data.status !== undefined && data.status !== "doing") {
    return {
      error:
        "remaining keeps the ticket in progress. Drop status, or finish the work and move it to review.",
    };
  }
  if (data.assigneeBotId && !(await ownBotInSpace(deps, input, data.assigneeBotId)))
    return { error: "Unknown bot." };
  const board = await ensureBoard(deps.prisma, input.spaceId);
  let blockerIds: string[] | undefined;
  if (data.blockedBy !== undefined) {
    const resolved = await resolveBlockers(deps, input.spaceId, board, data.blockedBy);
    if ("error" in resolved) return resolved;
    const self = await findTicket(deps.prisma, input.spaceId, board, { id: data.id });
    if (self && (resolved.ids.includes(self.id) || (await waitsOn(deps, resolved.ids, self.id)))) {
      return { error: "blockedBy: a ticket cannot wait on itself, directly or through others." };
    }
    blockerIds = resolved.ids;
  }
  const result = await deps.prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tickets WHERE id = ${data.id} AND "spaceId" = ${input.spaceId} FOR UPDATE`;
      const current = await tx.ticket.findFirst({
        where: { id: data.id, spaceId: input.spaceId, boardId: board.id },
      });
      if (!current) return null;
      const fields =
        data.fields !== undefined
          ? mergeFieldsOrThrow(readTicketFields(current.fields), data.fields)
          : undefined;
      const row = await tx.ticket.update({
        where: { id: current.id },
        data: {
          // A person acting on a ticket puts it back in the sweep's reach.
          ...(input.botId ? {} : { sweepEligibleAt: new Date() }),
          ...(fields !== undefined ? { fields } : {}),
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.priority !== undefined ? { priority: data.priority ?? "normal" } : {}),
          ...(data.assigneeBotId !== undefined ? { assigneeBotId: data.assigneeBotId } : {}),
          ...(data.acceptanceCriteria !== undefined
            ? { acceptanceCriteria: data.acceptanceCriteria || null }
            : {}),
          ...(data.remaining ? { remaining: data.remaining } : {}),
          ...(data.status !== undefined && data.status !== current.status && !data.remaining
            ? { remaining: null }
            : {}),
          ...(data.status !== undefined
            ? {
                status: data.status,
                // Someone moved it: it is no longer waiting on the computer's room.
                storagePausedFrom: null,
                completedAt: isTicketCompletedStatus(data.status)
                  ? (current.completedAt ?? new Date())
                  : null,
              }
            : {}),
        },
      });
      if (blockerIds !== undefined) {
        await tx.ticketDependency.deleteMany({ where: { ticketId: current.id } });
        if (blockerIds.length > 0) {
          await tx.ticketDependency.createMany({
            data: blockerIds.map((blockerId) => ({ ticketId: current.id, blockerId })),
          });
        }
      }
      return {
        row,
        previousStatus: coerceTicketStatus(current.status),
        reassigned:
          data.assigneeBotId !== undefined && data.assigneeBotId !== current.assigneeBotId,
      };
    })
    .catch((cause: unknown) => (cause instanceof FieldLimitError ? cause : Promise.reject(cause)));
  if (result instanceof FieldLimitError) return { error: result.message };
  if (!result) return { error: "Ticket not found." };
  const status = coerceTicketStatus(result.row.status);
  const moved =
    status !== result.previousStatus
      ? {
          ref: ticketRef(board.ticketPrefix, result.row.number),
          title: result.row.title,
          status,
          previousStatus: result.previousStatus,
          ...(toBoardDto(board).statusLabels[status]
            ? { statusLabel: toBoardDto(board).statusLabels[status] }
            : {}),
          ...(await moverOf(deps, input)),
        }
      : undefined;
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: board.id,
    ticketId: result.row.id,
    assigneeBotId: result.row.assigneeBotId,
    wakeAssignee: result.reassigned && result.row.assigneeBotId !== input.botId,
    ...(moved ? { moved } : {}),
  });
  return { ticket: await agentTicket(deps, result.row, board.ticketPrefix) };
}

/**
 * A comment from someone other than the owner on a ticket the owner has not finished is a
 * follow-up, so it goes through the ticket: it wakes the owner (and takes a Blocked ticket back
 * to In progress) instead of waiting for the next sweep.
 */
async function wakeForComment(
  deps: TicketToolDeps,
  ticket: { id: string; status: string; assigneeBotId: string | null },
  commenterBotId: string | undefined,
) {
  const follows =
    ticket.assigneeBotId !== null &&
    commenterBotId !== ticket.assigneeBotId &&
    ["todo", "doing", "blocked"].includes(ticket.status);
  if (!follows) return { wakeAssignee: false };
  if (ticket.status === "blocked") {
    await deps.prisma.ticket.updateMany({
      where: { id: ticket.id, status: "blocked" },
      data: { status: "doing" },
    });
  }
  return { wakeAssignee: true, continuation: ticket.status !== "todo", skipIfActive: true };
}

export async function commentTicket(
  deps: TicketToolDeps,
  input: {
    spaceId: string;
    botId?: string;
    userId?: string;
    id: string;
    body: string;
  },
) {
  if (!deps.ticketBoardEnabled) return { error: "Board unavailable." };
  const parsed = CommentTicketInput.safeParse({ ticketId: input.id, body: input.body });
  if (!parsed.success) return { error: ticketInputError(parsed.error) };
  const board = await ensureBoard(deps.prisma, input.spaceId);
  const ticket = await findTicket(deps.prisma, input.spaceId, board, { id: input.id });
  if (!ticket) return { error: "Ticket not found." };
  const row = await deps.prisma.$transaction(async (tx) => {
    const comment = await tx.ticketComment.create({
      include: { authorBot: { select: { name: true } }, authorUser: { select: { name: true } } },
      data: {
        ticketId: ticket.id,
        spaceId: input.spaceId,
        authorBotId: input.botId ?? null,
        authorUserId: input.userId ?? null,
        body: parsed.data.body,
      },
    });
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { updatedAt: new Date(), ...(input.botId ? {} : { sweepEligibleAt: new Date() }) },
    });
    return comment;
  });
  await deps.onTicketChange?.({
    spaceId: input.spaceId,
    boardId: board.id,
    ticketId: ticket.id,
    assigneeBotId: ticket.assigneeBotId,
    ...(await wakeForComment(deps, ticket, input.botId)),
  });
  return { comment: toTicketCommentDto(row) };
}
