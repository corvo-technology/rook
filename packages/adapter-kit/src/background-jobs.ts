import { z } from "zod";
import type {
  BackgroundJob,
  BackgroundJobExecution,
  BackgroundJobHandlers,
  BackgroundJobName,
  BackgroundJobPayloads,
} from "./types.js";

const payloadSchemas = {
  "run.continue": z.object({ runId: z.string().min(1) }),
  "routine.wakeup": z.object({
    routineId: z.string().min(1),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  "routine.retry": z.object({ runId: z.string().min(1) }),
  "routine.next-step": z.object({ runId: z.string().min(1) }),
  "computer.update": z.object({ updateId: z.string().min(1) }),
  "computer.sleep": z.object({ computerId: z.string().min(1) }),
  "computer.control-expire": z.object({
    computerId: z.string().min(1),
    leaseId: z.string().min(1),
  }),
  "skill.teaching-expire": z.object({ skillId: z.string().min(1) }),
  "call.expire": z.object({ threadId: z.string().min(1), callId: z.string().min(1) }),
  "history.compact": z.object({
    threadId: z.string().min(1),
    keepRecent: z.number().int().min(0).max(100).optional(),
  }),
  "wiki.curate": z.object({ threadId: z.string().min(1), messageId: z.string().min(1).optional() }),
  "wiki.review": z.object({
    spaceId: z.string().min(1),
    userId: z.string().min(1),
    manual: z.boolean().optional(),
  }),
  "wiki.retry": z.object({
    spaceId: z.string().min(1),
    userId: z.string().min(1),
    changeId: z.string().min(1),
  }),
  "memory.learn": z.object({ threadId: z.string().min(1) }),
  "bot.design-avatar": z.object({ botId: z.string().min(1) }),
  "messaging.deliver": z.object({ runId: z.string().min(1).optional() }),
  "messaging.credential-cleanup": z.object({
    installationId: z.string().min(1),
    ref: z.string().min(1),
  }),
  "cloud_agent.poll": z.object({ agentId: z.string().min(1) }),
  "push.receipt": z.object({
    userId: z.string().min(1),
    ticketId: z.string().min(1),
    tokenDigest: z.string().min(1),
  }),
  "audio.transcribe": z.object({ runId: z.string().min(1) }),
} satisfies { [Name in BackgroundJobName]: z.ZodType<BackgroundJobPayloads[Name]> };

export function parseBackgroundJob(name: string, payload: unknown): BackgroundJob {
  if (!(name in payloadSchemas)) throw new Error(`Unknown background job: ${name}`);
  const typedName = name as BackgroundJobName;
  const parsed = payloadSchemas[typedName].parse(payload);
  return { name: typedName, payload: parsed } as BackgroundJob;
}

export async function dispatchBackgroundJob(
  handlers: BackgroundJobHandlers,
  name: string,
  payload: unknown,
  execution?: BackgroundJobExecution,
): Promise<void> {
  const job = parseBackgroundJob(name, payload);
  const handler = handlers[job.name] as (
    payload: typeof job.payload,
    execution?: BackgroundJobExecution,
  ) => Promise<void>;
  if (execution) await handler(job.payload, execution);
  else await handler(job.payload);
}

export function runJobKey(runId: string): string {
  return `run:${runId}`;
}

export function routineJobKey(routineId: string): string {
  return `routine:${routineId}`;
}

export function computerSleepJobKey(computerId: string): string {
  return `computer.sleep:${computerId}`;
}

export function computerControlExpireJobKey(computerId: string, leaseId?: string): string {
  return leaseId
    ? `computer.control-expire:${computerId}:${leaseId}`
    : `computer.control-expire:${computerId}`;
}

export function skillTeachingExpireJobKey(skillId: string): string {
  return `skill.teaching-expire:${skillId}`;
}

export function audioTranscribeJobKey(runId: string): string {
  return `audio.transcribe:${runId}`;
}

/** Keyed to the run, so a repeated enqueue is one job. */
export function audioTranscribeJob(runId: string): BackgroundJob {
  return {
    name: "audio.transcribe",
    payload: { runId },
    replaceKey: audioTranscribeJobKey(runId),
  };
}

/** Keyed to the bot, so a repeated enqueue designs once. A model that fails is not asked again. */
export function botAvatarDesignJob(botId: string): BackgroundJob {
  return {
    name: "bot.design-avatar",
    payload: { botId },
    replaceKey: `bot.design-avatar:${botId}`,
    maxAttempts: 1,
  };
}

export function runContinueJob(runId: string): BackgroundJob {
  return {
    name: "run.continue",
    payload: { runId },
    replaceKey: runJobKey(runId),
  };
}

export function routineWakeupJob(routineId: string, scheduledFor: Date): BackgroundJob {
  return {
    name: "routine.wakeup",
    payload: { routineId, scheduledFor: scheduledFor.toISOString() },
    availableAt: scheduledFor,
    replaceKey: routineJobKey(routineId),
  };
}

/** Keyed to the failed run, so a repeated enqueue keeps a single retry. */
export function routineRetryJob(runId: string, availableAt: Date): BackgroundJob {
  return {
    name: "routine.retry",
    payload: { runId },
    availableAt,
    replaceKey: `routine.retry:${runId}`,
  };
}

/** Keyed to the completed run, so a repeated enqueue starts the next step once. */
export function routineNextStepJob(runId: string): BackgroundJob {
  return {
    name: "routine.next-step",
    payload: { runId },
    replaceKey: `routine.next-step:${runId}`,
  };
}

export function computerSleepJob(computerId: string, availableAt: Date): BackgroundJob {
  return {
    name: "computer.sleep",
    payload: { computerId },
    availableAt,
    replaceKey: computerSleepJobKey(computerId),
  };
}

export function computerControlExpireJob(
  computerId: string,
  leaseId: string,
  availableAt: Date,
): BackgroundJob {
  return {
    name: "computer.control-expire",
    payload: { computerId, leaseId },
    availableAt,
    replaceKey: computerControlExpireJobKey(computerId, leaseId),
  };
}

export function skillTeachingExpireJob(skillId: string, availableAt: Date): BackgroundJob {
  return {
    name: "skill.teaching-expire",
    payload: { skillId },
    availableAt,
    replaceKey: skillTeachingExpireJobKey(skillId),
  };
}

export function callExpireJob(threadId: string, callId: string, availableAt: Date): BackgroundJob {
  return {
    name: "call.expire",
    payload: { threadId, callId },
    availableAt,
    replaceKey: `call.expire:${callId}`,
  };
}

export function historyCompactJobKey(threadId: string): string {
  return `history.compact:${threadId}`;
}

/**
 * Each attempt runs a summarizer completion that can take up to the summarizer
 * timeout, so the job queue's default attempt count turns one permanently
 * failing thread into hours of paid retries. A few tries ride out transient
 * provider errors without storming.
 */
export const HISTORY_COMPACT_MAX_ATTEMPTS = 4;

export function messagingDeliverJob(runId?: string, availableAt?: Date): BackgroundJob {
  return {
    name: "messaging.deliver",
    payload: runId ? { runId } : {},
    replaceKey: `messaging.deliver:${runId ?? "drain"}`,
    ...(availableAt ? { availableAt } : {}),
  };
}

/**
 * `keepRecent` compresses everything but that many of the newest messages, batch after batch,
 * instead of waiting for the message-count threshold: what the person's "compress" asks for.
 */
export function historyCompactJob(threadId: string, keepRecent?: number): BackgroundJob {
  return {
    name: "history.compact",
    payload: keepRecent === undefined ? { threadId } : { threadId, keepRecent },
    replaceKey: historyCompactJobKey(threadId),
    maxAttempts: HISTORY_COMPACT_MAX_ATTEMPTS,
  };
}

/** How long a conversation stays quiet before the wiki curator reads what was said. */
export const WIKI_CURATE_QUIET_MS = 20_000;
/** A model that answers badly or is down is tried a few times, not for hours. */
export const WIKI_CURATE_MAX_ATTEMPTS = 3;

/**
 * Reads a conversation for the wiki once it has been quiet; each new reply replaces the waiting job
 * under the same key and so pushes the read back. A message kept on purpose runs at once under a
 * key of its own, so it never takes the place of the quiet read.
 */
export function wikiCurateJob(
  threadId: string,
  options: { messageId?: string; now?: Date } = {},
): BackgroundJob {
  const { messageId } = options;
  return {
    name: "wiki.curate",
    payload: messageId ? { threadId, messageId } : { threadId },
    replaceKey: messageId ? `wiki.curate:${threadId}:${messageId}` : `wiki.curate:${threadId}`,
    ...(messageId
      ? {}
      : { availableAt: new Date((options.now ?? new Date()).getTime() + WIKI_CURATE_QUIET_MS) }),
    maxAttempts: WIKI_CURATE_MAX_ATTEMPTS,
  };
}

/**
 * Reviews a Space's wiki. One waiting review per Space: asking again while one waits is one job.
 * The weekly one (`manual` unset) does nothing until a week has passed since the last.
 */
export function wikiReviewJob(
  scope: { spaceId: string; userId: string },
  options: { manual?: boolean } = {},
): BackgroundJob {
  return {
    name: "wiki.review",
    payload: options.manual ? { ...scope, manual: true } : scope,
    replaceKey: `wiki.review:${scope.spaceId}`,
    maxAttempts: WIKI_CURATE_MAX_ATTEMPTS,
  };
}

/** Keyed to the change, so a repeated ask is one try. */
export function wikiRetryJob(
  scope: { spaceId: string; userId: string },
  changeId: string,
): BackgroundJob {
  return {
    name: "wiki.retry",
    payload: { ...scope, changeId },
    replaceKey: `wiki.retry:${changeId}`,
    maxAttempts: WIKI_CURATE_MAX_ATTEMPTS,
  };
}

/** How long a conversation stays quiet before the memory model reads what the person said. */
export const MEMORY_LEARN_QUIET_MS = 30_000;

/** Like the wiki read, keyed to the conversation: each new reply pushes the quiet read back. */
export function memoryLearnJob(threadId: string, options: { now?: Date } = {}): BackgroundJob {
  return {
    name: "memory.learn",
    payload: { threadId },
    replaceKey: `memory.learn:${threadId}`,
    availableAt: new Date((options.now ?? new Date()).getTime() + MEMORY_LEARN_QUIET_MS),
    maxAttempts: WIKI_CURATE_MAX_ATTEMPTS,
  };
}

/** A few tries ride out an Expo outage well inside the day it keeps receipts. */
export function pushReceiptJob(
  payload: BackgroundJobPayloads["push.receipt"],
  availableAt: Date,
): BackgroundJob {
  return { name: "push.receipt", payload, availableAt, maxAttempts: 8 };
}

export function cloudAgentPollJobKey(agentId: string): string {
  return `cloud_agent.poll:${agentId}`;
}

export function cloudAgentPollJob(
  payload: BackgroundJobPayloads["cloud_agent.poll"],
  availableAt?: Date,
): BackgroundJob {
  return {
    name: "cloud_agent.poll",
    payload,
    replaceKey: cloudAgentPollJobKey(payload.agentId),
    ...(availableAt ? { availableAt } : {}),
  };
}
