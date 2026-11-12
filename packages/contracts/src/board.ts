import * as z from "zod";
import { Id } from "./ids.js";

export const TICKET_STATUSES = ["todo", "doing", "review", "blocked", "done", "closed"] as const;
export const TicketStatusSchema = z.enum(TICKET_STATUSES);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

/** `done` is finished-but-open for review; `closed` is terminal, so both stamp completion. */
export function isTicketCompletedStatus(status: TicketStatus): boolean {
  return status === "done" || status === "closed";
}

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TicketPrioritySchema = z.enum(TICKET_PRIORITIES);
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;
const DEFAULT_TICKET_PRIORITY: TicketPriority = "normal";

export const TICKET_TITLE_MAX_LENGTH = 200;
export const TICKET_DESCRIPTION_MAX_LENGTH = 20_000;
const TICKET_PREFIX_MAX_LENGTH = 12;
// Ticket numbers are stored as PostgreSQL Int values.
const TICKET_NUMBER_MAX = 2_147_483_647;
export const TICKET_COMMENT_MAX_LENGTH = 10_000;

const TicketPrefixSchema = z
  .string()
  .trim()
  .min(1)
  .max(TICKET_PREFIX_MAX_LENGTH)
  .regex(
    /^[A-Za-z][A-Za-z0-9]*$/,
    "Prefix must start with a letter and contain only letters and digits",
  );

export function ticketRef(prefix: string, number: number): string {
  return `${prefix}-${number}`;
}

export function parseTicketRef(
  value: string,
  expectedPrefix?: string,
): { prefix: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]*)-([1-9][0-9]*)$/.exec(value.trim());
  if (!match) return null;
  const [, rawPrefix, rawNumber] = match;
  if (!rawPrefix || !rawNumber) return null;
  const prefix = rawPrefix.toUpperCase();
  if (expectedPrefix !== undefined && prefix !== expectedPrefix.trim().toUpperCase()) return null;
  const number = Number(rawNumber);
  if (number > TICKET_NUMBER_MAX) return null;
  return { prefix, number };
}

export const BOARD_LABEL_MAX_LENGTH = 40;
const BoardLabelSchema = z.string().trim().min(1).max(BOARD_LABEL_MAX_LENGTH);
/** The column names a board changed. A status with no entry keeps its built-in name. */
export const BoardStatusLabelsSchema = z.partialRecord(TicketStatusSchema, BoardLabelSchema);
export type BoardStatusLabels = z.infer<typeof BoardStatusLabelsSchema>;

export const BoardSchema = z.object({
  id: Id,
  spaceId: Id,
  name: z.string(),
  ticketPrefix: z.string(),
  statusLabels: BoardStatusLabelsSchema.default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Board = z.infer<typeof BoardSchema>;

export const RenameBoardInput = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    ticketPrefix: TicketPrefixSchema.optional(),
    /** A label of null removes the override, so the column goes back to its built-in name. */
    statusLabels: z.partialRecord(TicketStatusSchema, BoardLabelSchema.nullable()).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.ticketPrefix !== undefined ||
      value.statusLabels !== undefined,
    { message: "Provide a name, ticketPrefix or statusLabels" },
  );
export type RenameBoardInput = z.infer<typeof RenameBoardInput>;

export const TicketCommentSchema = z.object({
  id: Id,
  ticketId: Id,
  body: z.string(),
  authorBotId: Id.nullable(),
  authorUserId: Id.nullable(),
  authorName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TicketComment = z.infer<typeof TicketCommentSchema>;

export const TICKET_FIELDS_MAX = 20;
export const TICKET_FIELD_NAME_MAX_LENGTH = 60;
export const TICKET_FIELD_VALUE_MAX_LENGTH = 500;
const TicketFieldNameSchema = z.string().trim().min(1).max(TICKET_FIELD_NAME_MAX_LENGTH);
const TicketFieldValueSchema = z.string().max(TICKET_FIELD_VALUE_MAX_LENGTH);
export const TicketFieldSchema = z.object({
  name: TicketFieldNameSchema,
  value: TicketFieldValueSchema,
});
export type TicketField = z.infer<typeof TicketFieldSchema>;
export const TicketFieldsSchema = z.array(TicketFieldSchema).max(TICKET_FIELDS_MAX);

/**
 * Apply a change to a ticket's fields: a name sets or replaces the field of that name (case does
 * not matter, the first spelling stays), and an empty value removes it.
 */
export function mergeTicketFields(
  current: readonly TicketField[],
  patch: Record<string, string>,
): TicketField[] {
  const next = current.map((field) => ({ ...field }));
  for (const [rawName, value] of Object.entries(patch)) {
    const name = rawName.trim();
    const at = next.findIndex((field) => field.name.toLowerCase() === name.toLowerCase());
    if (value === "") {
      if (at >= 0) next.splice(at, 1);
    } else if (at >= 0) {
      const existing = next[at];
      if (existing) existing.value = value;
    } else {
      next.push({ name, value });
    }
  }
  if (next.length > TICKET_FIELDS_MAX) {
    throw new Error(`A ticket holds at most ${TICKET_FIELDS_MAX} fields.`);
  }
  return next;
}

export const TicketSchema = z.object({
  id: Id,
  boardId: Id,
  spaceId: Id,
  number: z.number().int().positive(),
  ref: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  assigneeBotId: Id.nullable(),
  createdByBotId: Id.nullable(),
  createdByUserId: Id.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
  fields: TicketFieldsSchema.default([]),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const ListTicketsInput = z.object({
  boardId: Id.optional(),
  status: TicketStatusSchema.optional(),
  /** More than one status at once; combined with `status` by union. Empty means no filter. */
  statuses: z.array(TicketStatusSchema).max(TICKET_STATUSES.length).optional(),
  assigneeBotId: Id.optional(),
  q: z.string().trim().max(200).optional(),
});
export type ListTicketsInput = z.infer<typeof ListTicketsInput>;

export const ListTicketsOutput = z.object({ tickets: z.array(TicketSchema) });
export type ListTicketsOutput = z.infer<typeof ListTicketsOutput>;

export const GetTicketInput = z
  .object({
    id: Id.optional(),
    ref: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => Boolean(value.id) !== Boolean(value.ref), {
    message: "Provide exactly one of id or ref",
  });
export type GetTicketInput = z.infer<typeof GetTicketInput>;

export const CreateTicketInput = z.object({
  boardId: Id.optional(),
  title: z.string().trim().min(1).max(TICKET_TITLE_MAX_LENGTH),
  description: z.string().max(TICKET_DESCRIPTION_MAX_LENGTH).optional(),
  priority: TicketPrioritySchema.default(DEFAULT_TICKET_PRIORITY),
  assigneeBotId: Id,
});
export type CreateTicketInput = z.infer<typeof CreateTicketInput>;

export const UpdateTicketInput = z.object({
  id: Id,
  title: z.string().trim().min(1).max(TICKET_TITLE_MAX_LENGTH).optional(),
  description: z.string().max(TICKET_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  priority: TicketPrioritySchema.nullable().optional(),
  status: TicketStatusSchema.optional(),
  assigneeBotId: Id.optional(),
  /** Set a field by name; an empty value removes it. */
  fields: z.record(TicketFieldNameSchema, TicketFieldValueSchema).optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketInput>;

export const MoveTicketInput = z.object({
  id: Id,
  status: TicketStatusSchema,
});
export type MoveTicketInput = z.infer<typeof MoveTicketInput>;

export const CommentTicketInput = z.object({
  ticketId: Id,
  body: z.string().trim().min(1).max(TICKET_COMMENT_MAX_LENGTH),
});
export type CommentTicketInput = z.infer<typeof CommentTicketInput>;

/** A ticket changed column. `byBotId` is null when a person moved it. */
export const BoardMoveSchema = z.object({
  ref: z.string(),
  title: z.string(),
  status: TicketStatusSchema,
  previousStatus: TicketStatusSchema,
  /** The board's own name for the new column, when it set one. */
  statusLabel: z.string().optional(),
  byBotId: Id.nullable(),
  byName: z.string().nullable(),
});
export type BoardMove = z.infer<typeof BoardMoveSchema>;

/** What an agent is doing on a ticket right now. */
export const BoardStepSchema = z.object({ botId: Id, text: z.string() });
export type BoardStep = z.infer<typeof BoardStepSchema>;

/**
 * `step` is the agent's latest step on `ticketId`, or null once its run ended. A signal with a
 * step and no `moved` changes nothing in the list, so clients need not read it again.
 */
export const BoardEventSchema = z.object({
  spaceId: Id,
  boardId: Id.optional(),
  ticketId: Id.optional(),
  moved: BoardMoveSchema.optional(),
  step: BoardStepSchema.nullable().optional(),
  createdAt: z.string(),
});
export type BoardEvent = z.infer<typeof BoardEventSchema>;
