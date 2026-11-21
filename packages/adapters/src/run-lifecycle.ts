import { runContinueJob } from "@corvo/adapter-kit";
import type { EscalationTrigger, ModelTier, RunStopReason } from "@corvo/contracts";
import { displayName } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { returnBotMessageOutcome, runReturnsOutcome } from "./bot-messages.js";
import { withComputerScreenAvailability } from "./computer-screens.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { closeHandoffGroup } from "./handoff-summary.js";
import { classifyRunError } from "./run-error-code.js";
import { notifyRun } from "./run-notifications.js";
import type { TakeoverResumeCheckpoint } from "./takeover-resume.js";
import { TAKEOVER_RESUME_CHECKPOINTS } from "./takeover-resume.js";
import { endTicketRun } from "./ticket-run-moves.js";

/**
 * Avoid an expensive remote workspace export when a turn never touched the computer. A failed
 * export does not fail the run: its work is done, the computer keeps the files, and the idle
 * sleep checkpoints them again before stopping it. Only cancelling the run stops it.
 */
export function createRunWorkspaceCheckpoint(
  checkpoint: () => Promise<unknown>,
  signal?: AbortSignal,
) {
  let dirty = false;
  return {
    markDirty() {
      dirty = true;
    },
    markFiles(files: readonly unknown[]) {
      if (files.length > 0) dirty = true;
    },
    async flush() {
      if (!dirty) return false;
      dirty = false;
      try {
        await checkpoint();
        return true;
      } catch (error) {
        dirty = true;
        if (signal?.aborted) throw error;
        getLogger().warn("computer.checkpoint_deferred", { error });
        return false;
      }
    },
  };
}

export async function computerScreenToolResult(
  work: () => Promise<unknown>,
  finish?: (result: unknown) => Promise<unknown>,
) {
  const result = await withComputerScreenAvailability(work);
  return finish ? finish(result) : result;
}

/** Fails a run that never reached the model and tells the people waiting on it. */
export async function failRunBeforeTurn(
  deps: ExecutorDeps,
  run: {
    id: string;
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    taskId: string;
    trigger: string;
    routineId?: string | null;
    sourceMessageId?: string | null;
    ticketId?: string | null;
  },
  botName: string,
  lease: { attemptId: string; workerId: string; fence: number },
  message: string,
  options: { stopReason?: RunStopReason; silent?: boolean } = {},
): Promise<boolean> {
  const errorInfo = classifyRunError(new Error(message), message, {
    botName,
    stopReason: options.stopReason,
  });
  const failed = await deps.events.finalizeRun({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId: run.id,
    taskId: run.taskId,
    attemptId: lease.attemptId,
    leaseOwner: lease.workerId,
    leaseFence: lease.fence,
    outcome: "failed",
    error: message,
    errorInfo,
    ...(options.stopReason ? { stopReason: options.stopReason } : {}),
  });
  if (!failed) return false;
  await endTicketRun(deps, run, { kind: "stopped", error: message });
  if (failed.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(failed.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  if (await runReturnsOutcome(deps.prisma, run)) {
    await returnBotMessageOutcome(
      deps,
      run,
      { id: run.botId, name: botName },
      `Could not complete the delegated request: ${message}`,
      "status",
      { forceUnread: true, failed: true },
    ).catch((error) => getLogger().error("bot message failure return", error));
  }
  if (!failed.continuationRunId && !options.silent) {
    await notifyRun(deps, run, {
      kind: "failure",
      title: `${displayName(botName, "Bot")} failed`,
      body: message,
      botId: run.botId,
      threadId: run.threadId,
      errorInfo,
    });
  }
  await closeHandoffGroup(deps, run);
  return true;
}

/**
 * A run's lease lasts this long without a heartbeat. After a kill nothing releases it, so
 * this is also how long the run waits before the recovery scan hands it to another worker.
 */
export const RUN_LEASE_TTL_MS = 2 * 60_000;
export const RUN_LEASE_HEARTBEAT_MS = 30_000;

/**
 * The worker is shutting down and this run did not finish in time. Hand it back as queued,
 * keeping its checkpoint, so the next worker continues it instead of waiting for the lease
 * to expire. The lease fence keeps this a no-op once another worker has claimed the run.
 */
export async function releaseRunForShutdown(
  deps: ExecutorDeps,
  runId: string,
  workerId: string,
  fence: number,
): Promise<boolean> {
  const released = await deps.prisma.run.updateMany({
    where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
    data: { status: "queued", error: null, leaseOwner: null, leaseExpiresAt: null, wakeAt: null },
  });
  return released.count === 1;
}

/**
 * Puts a run back in the queue on the next tier up, once. The lease fence and the escalation count
 * in the filter make a second escalation, or one from a worker that lost the run, a no-op.
 */
export async function escalateRunTier(
  deps: ExecutorDeps,
  runId: string,
  workerId: string,
  fence: number,
  to: ModelTier,
  why?: { trigger: EscalationTrigger; reason?: string },
): Promise<boolean> {
  const moved = await deps.prisma.run.updateMany({
    where: {
      id: runId,
      status: "running",
      leaseOwner: workerId,
      leaseFence: fence,
      tierEscalations: 0,
    },
    data: {
      status: "queued",
      error: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      wakeAt: null,
      modelTier: to,
      tierEscalations: { increment: 1 },
      ...(why ? { escalationTrigger: why.trigger, escalationReason: why.reason ?? null } : {}),
    },
  });
  if (moved.count !== 1) return false;
  await deps.jobs.enqueue(runContinueJob(runId));
  return true;
}

export async function renewRunLease(
  deps: ExecutorDeps,
  runId: string,
  workerId: string,
  fence: number,
): Promise<boolean> {
  const renewed = await deps.prisma.run.updateMany({
    where: {
      id: runId,
      status: "running",
      leaseOwner: workerId,
      leaseFence: fence,
    },
    data: { leaseExpiresAt: new Date(Date.now() + RUN_LEASE_TTL_MS) },
  });
  return renewed.count === 1;
}

/** Pauses between heartbeat retries: a database blip of about a second must not cost the run. */
export const HEARTBEAT_RETRY_BACKOFF_MS: readonly number[] = [200, 500, 1_000];

/**
 * Renews the leases, retrying a thrown error (connection blip) with short backoff.
 * `held`: renewed. `lost`: the database answered and another owner has the lease, a real
 * invalidation. `unreachable`: every try threw, so the lease state is unknown.
 */
export async function renewLeasesTolerantly(
  renew: () => Promise<boolean>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<"held" | "lost" | "unreachable"> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await renew()) ? "held" : "lost";
    } catch {
      const pause = HEARTBEAT_RETRY_BACKOFF_MS[attempt];
      if (pause === undefined) return "unreachable";
      await sleep(pause);
    }
  }
}

/**
 * Abort at once on a real invalidation. When the database cannot be reached, keep going
 * until one more missed beat would let the lease expire under the run.
 */
export function heartbeatShouldAbort(
  outcome: "held" | "lost" | "unreachable",
  lastRenewedAt: number,
  now = Date.now(),
): boolean {
  if (outcome === "held") return false;
  if (outcome === "lost") return true;
  return now - lastRenewedAt >= RUN_LEASE_TTL_MS - RUN_LEASE_HEARTBEAT_MS;
}

/** Consecutive setup failures, including this one, after which a run fails instead of retrying. */
export const RUN_SETUP_FAILURE_LIMIT = 8;

/**
 * Setup failures in a row before the current attempt. Busy-computer and database waits are
 * setup_failed attempts without an error; they neither count nor break the streak.
 */
export async function setupFailureStreak(prisma: PrismaClient, runId: string): Promise<number> {
  const recent = await prisma.attempt.findMany({
    where: {
      runId,
      status: { not: "running" },
      NOT: { status: "setup_failed", error: null },
    },
    orderBy: { fence: "desc" },
    take: RUN_SETUP_FAILURE_LIMIT,
    select: { status: true },
  });
  const streak = recent.findIndex((attempt) => attempt.status !== "setup_failed");
  return streak === -1 ? recent.length : streak;
}

export function computerRetryDelay(fence: number): number {
  return Math.min(10_000, 250 * 2 ** Math.min(Math.max(fence - 1, 0), 5));
}

/** Open the model only while this worker still owns the running lease. */
export function mayOpenModelStream(
  run: { status: string; leaseOwner: string | null; leaseFence: number | null } | null,
  workerId: string,
  fence: number,
  aborted: boolean,
): boolean {
  return (
    run?.status === "running" && run.leaseOwner === workerId && run.leaseFence === fence && !aborted
  );
}

function computerRunRequeueData(
  resumeCheckpoint: TakeoverResumeCheckpoint | null,
  error: string | null = null,
  heldForTakeover = false,
) {
  return {
    status:
      heldForTakeover && !resumeCheckpoint ? ("waiting_takeover" as const) : ("queued" as const),
    error,
    leaseOwner: null,
    leaseExpiresAt: null,
    checkpoint: resumeCheckpoint,
  };
}

export async function writeComputerRunRequeue(
  deps: ExecutorDeps,
  runId: string,
  workerId: string,
  fence: number,
  resumeCheckpoint: TakeoverResumeCheckpoint | null,
  heldForTakeover = false,
  error: string | null = null,
): Promise<boolean> {
  const whereLease = {
    id: runId,
    status: "running" as const,
    leaseOwner: workerId,
    leaseFence: fence,
  };
  const releasedHold = {
    status: "queued" as const,
    wakeAt: new Date(Date.now() + computerRetryDelay(fence)),
    error,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
  const preserve = await deps.prisma.run.updateMany({
    where: {
      ...whereLease,
      checkpoint: { in: [...TAKEOVER_RESUME_CHECKPOINTS] },
    },
    data: releasedHold,
  });
  if (preserve.count === 1) return true;
  const planned = await deps.prisma.run.updateMany({
    where: { ...whereLease, checkpoint: null },
    data: {
      ...computerRunRequeueData(resumeCheckpoint, error, heldForTakeover),
      wakeAt: releasedHold.wakeAt,
    },
  });
  if (planned.count === 1) return true;
  const retried = await deps.prisma.run.updateMany({
    where: {
      ...whereLease,
      checkpoint: { in: [...TAKEOVER_RESUME_CHECKPOINTS] },
    },
    data: releasedHold,
  });
  return retried.count === 1;
}

export async function requeueComputerRun(
  deps: ExecutorDeps,
  runId: string,
  workerId: string,
  fence: number,
  resumeCheckpoint: TakeoverResumeCheckpoint | null,
  heldForTakeover = false,
): Promise<void> {
  const released = await writeComputerRunRequeue(
    deps,
    runId,
    workerId,
    fence,
    resumeCheckpoint,
    heldForTakeover,
  );
  if (!released) return;
  await deps.jobs.enqueue({
    ...runContinueJob(runId),
    availableAt: new Date(Date.now() + computerRetryDelay(fence)),
  });
}
