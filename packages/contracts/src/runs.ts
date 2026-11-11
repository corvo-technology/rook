import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";

/** The computer provider refused a request at its own rate limit; the run tells the user to wait. */
export const COMPUTER_RATE_LIMIT_ERROR = "Too many computer requests. Try again later.";

export const RUN_TRIGGERS = [
  "user",
  "routine",
  "resume",
  "follow_up",
  "reaction",
  "call_end",
  "spawn",
  "skill",
  "bot_message",
  "webhook",
  "messaging",
  "cloud_agent",
  "created",
  "tickets",
] as const;
export const RunTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

/** Why the run guards ended a run that was going nowhere; each has its own fixed run error. */
export const TURN_GUARD_KINDS = ["loop", "tool_errors", "stall", "waiting"] as const;
export type TurnGuardKind = (typeof TURN_GUARD_KINDS)[number];

/** Why a run was stopped on purpose, saved beside its error. Null for a run that failed on its own. */
export const RUN_STOP_REASONS = [...TURN_GUARD_KINDS] as const;
export const RunStopReasonSchema = z.enum(RUN_STOP_REASONS);
export type RunStopReason = z.infer<typeof RunStopReasonSchema>;

/**
 * Whose problem a failed run is. Every kind except "output" is the user's provider account,
 * key, plan or model choice; "output" is a model that returned nothing usable.
 */
export const RUN_ERROR_KINDS = [
  "key",
  "credit",
  "spending",
  "rate",
  "auth",
  "access",
  "model",
  "context",
  "output",
  ...TURN_GUARD_KINDS,
] as const;
export type RunErrorKind = (typeof RUN_ERROR_KINDS)[number];

/** A limit that resets later than this is a quota to wait out, not a rate limit to retry. */
const PROVIDER_QUOTA_MIN_RESET_MS = 60 * 60_000;

/**
 * When a provider error says its exhausted limit resets, if that is over an hour away. Gateways
 * copy the response's `X-RateLimit-Reset` (an epoch in seconds or milliseconds) or `Retry-After`
 * (seconds) headers into the error body, which is all a model runtime passes on.
 */
export function providerQuotaResetAt(text: string, now = Date.now()): number | undefined {
  const epoch = text.match(/\bx-ratelimit-reset\\?"?\s*[:=]\s*\\?"?(\d{10,13})(?!\d)/i)?.[1];
  const delay = text.match(/\bretry-after\\?"?\s*[:=]\s*\\?"?(\d+)(?![\d.])/i)?.[1];
  const resetAt = epoch
    ? Number(epoch) * (epoch.length > 10 ? 1 : 1000)
    : delay
      ? now + Number(delay) * 1000
      : undefined;
  return resetAt !== undefined && resetAt - now > PROVIDER_QUOTA_MIN_RESET_MS ? resetAt : undefined;
}

/** Marks an RPC error whose `data.modelFailure` carries the facts behind a failed model call. */
export const MODEL_FAILURE_REASON = "model_failure";

/** What a model probe or run knows about a failure, as structured signals plus the raw text. */
export const ModelFailureDataSchema = z.object({
  details: z.string().max(8000),
  status: z.number().int().min(100).max(599).optional(),
  code: z.string().max(64).optional(),
});
export type ModelFailureData = z.infer<typeof ModelFailureDataSchema>;

export const RoutineRunSchema = z.object({
  id: Id,
  botId: Id,
  groupId: Id.nullable(),
  status: RunStatus,
  error: z.string().nullable(),
  createdAt: IsoDate,
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  messageId: Id.nullable(),
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

export const RoutineRunCursorSchema = z.object({ id: Id, createdAt: IsoDate });
export type RoutineRunCursor = z.infer<typeof RoutineRunCursorSchema>;
/** Runs per history page; the first page a screen shows is shorter. */
export const ROUTINE_HISTORY_PAGE_SIZE = 20;
export const ROUTINE_HISTORY_FIRST_PAGE_SIZE = 5;
export const RoutineHistorySchema = z.object({
  runs: z.array(RoutineRunSchema),
  nextCursor: RoutineRunCursorSchema.nullable(),
});
export type RoutineHistory = z.infer<typeof RoutineHistorySchema>;

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  agentMessage: z
    .discriminatedUnion("kind", [
      z.strictObject({
        fromBotName: z.string(),
        kind: z.enum(["update", "request"]),
        text: z.string().max(120),
      }),
      z.strictObject({ kind: z.literal("unknown") }),
    ])
    .nullable(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;

/** One entry on the routines calendar: a run that happened, or one that is due. */
export const RoutineOccurrenceSchema = z.object({
  routineId: Id,
  name: z.string(),
  botId: Id,
  botName: z.string(),
  at: IsoDate,
  /** `upcoming` is computed from the schedule; the rest come from the run itself. */
  state: z.enum(["upcoming", "running", "done", "failed"]),
  runId: Id.nullable(),
});
export type RoutineOccurrence = z.infer<typeof RoutineOccurrenceSchema>;

/** Longest span a calendar query may cover: a month view plus its padding. */
export const ROUTINE_CALENDAR_MAX_DAYS = 42;
export const ROUTINE_CALENDAR_MAX_ITEMS = 600;
export const RoutineCalendarSchema = z.object({
  occurrences: z.array(RoutineOccurrenceSchema),
  /** True when the span held more than the limit and the later entries were left out. */
  truncated: z.boolean(),
});
export type RoutineCalendar = z.infer<typeof RoutineCalendarSchema>;
