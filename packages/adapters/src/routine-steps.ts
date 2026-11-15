import { routineNextStepJob, runContinueJob } from "@corvo/adapter-kit";
import { getLogger } from "@corvo/logging";
import { personMayTalkTo } from "./agent-audience.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { botRunOutcomeText } from "./job-reconciler.js";
import { routineRunModelPin } from "./model-selection.js";
import { isUniqueViolation } from "./run-messages.js";

const NO_WRITTEN_ANSWER = "(no written answer)";
/** How many steps back a step is shown, and how much of each answer older than the last. */
const EARLIER_RESULTS = 4;
const EARLIER_RESULT_CHARS = 4_000;

export type StepResult = { bot: string; answer: string };

/** What a step is told about the answers before it, oldest first, the last being the step just done. */
export function stepPrompt(instruction: string, results: readonly StepResult[]): string {
  return [
    instruction,
    ...results.map((result) => `Result from ${result.bot}:\n${result.answer}`),
  ].join("\n\n");
}

/** The run a step followed; a retry of a step follows what the step it retries followed. */
async function previousStepRun(
  prisma: ExecutorDeps["prisma"],
  run: { stepOfRunId: string | null; retryOfRunId: string | null },
): Promise<string | null> {
  if (run.stepOfRunId) return run.stepOfRunId;
  if (!run.retryOfRunId) return null;
  const retried = await prisma.run.findUnique({
    where: { id: run.retryOfRunId },
    select: { stepOfRunId: true },
  });
  return retried?.stepOfRunId ?? null;
}

/** The answers of the steps before the one just done, oldest first, each cut to a fixed length. */
async function earlierStepResults(
  deps: ExecutorDeps,
  done: { stepOfRunId: string | null; retryOfRunId: string | null },
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  let link = await previousStepRun(deps.prisma, done);
  while (link && results.length < EARLIER_RESULTS) {
    const run = await deps.prisma.run.findUnique({
      where: { id: link },
      include: { bot: { select: { name: true } } },
    });
    if (!run) break;
    const { text } = await botRunOutcomeText(deps.prisma, run.id);
    results.unshift({
      bot: run.bot.name,
      answer: text.trim().slice(0, EARLIER_RESULT_CHARS) || NO_WRITTEN_ANSWER,
    });
    link = await previousStepRun(deps.prisma, run);
  }
  return results;
}

/** The workflow tool a step calls when nothing is left for the steps after it. */
export const WORKFLOW_STOP_TOOL = "workflow_stop";

/** Whether a routine run has steps after it, so it may end the chain early. */
export async function workflowContinuesAfter(
  prisma: ExecutorDeps["prisma"],
  run: { routineId: string | null; routineStepId: string | null },
): Promise<boolean> {
  if (!run.routineId) return false;
  const current = run.routineStepId
    ? await prisma.routineStep.findUnique({
        where: { id: run.routineStepId },
        select: { position: true },
      })
    : null;
  return (
    (await prisma.routineStep.count({
      where: { routineId: run.routineId, position: { gt: current?.position ?? 1 } },
    })) > 0
  );
}

/** Queue the next step when the routine has one; a failure to queue is logged, never thrown. */
export async function startWorkflowStepAfter(deps: ExecutorDeps, routineId: string, runId: string) {
  try {
    const steps = await deps.prisma.routineStep.count({ where: { routineId } });
    if (steps > 0) await deps.jobs.enqueue(routineNextStepJob(runId));
  } catch (error) {
    getLogger().error("routine next step enqueue", error);
  }
}

/**
 * After a routine run completes, start the next step of its workflow: its agent gets the step's
 * instruction and the answer the completed run gave. A step that failed or was cancelled never
 * reaches here, so it ends the chain, and so does one that called workflow_stop. stepOfRunId is unique, so another delivery of the job
 * finds the step already started.
 */
export async function startNextRoutineStep(deps: ExecutorDeps, runId: string) {
  const done = await deps.prisma.run.findUnique({
    where: { id: runId },
    include: { bot: { select: { name: true } } },
  });
  if (!done?.routineId || done.trigger !== "routine" || done.status !== "completed") return;
  // The step said there is nothing left for the ones after it.
  const stopped = await deps.prisma.event.findFirst({
    where: {
      runId,
      type: "agent.tool.called",
      payload: { path: ["name"], equals: WORKFLOW_STOP_TOOL },
    },
    select: { id: true },
  });
  if (stopped) return;
  const current = done.routineStepId
    ? await deps.prisma.routineStep.findUnique({
        where: { id: done.routineStepId },
        select: { position: true },
      })
    : null;
  const next = await deps.prisma.routineStep.findFirst({
    where: { routineId: done.routineId, position: { gt: current?.position ?? 1 } },
    orderBy: { position: "asc" },
  });
  if (!next) return;
  const bot = await deps.prisma.bot.findFirst({
    where: { id: next.botId, spaceId: done.spaceId, archivedAt: null },
    include: { thread: true },
  });
  const routine = await deps.prisma.routine.findUnique({
    where: { id: done.routineId },
    select: { modelProvider: true, modelId: true, thinkingLevel: true },
  });
  if (!bot?.thread || !routine) {
    getLogger().warn("routine.step_skipped", { "run.id": done.id, "step.id": next.id });
    return;
  }
  // The routine's creator started this run: a step's agent that leaves them out is not woken.
  if (!(await personMayTalkTo(deps.prisma, { spaceId: done.spaceId, userId: done.userId }, bot))) {
    getLogger().warn("routine.step_skipped", { "run.id": done.id, "step.id": next.id });
    return;
  }
  const { text } = await botRunOutcomeText(deps.prisma, done.id);
  const prompt = stepPrompt(next.instruction, [
    ...(await earlierStepResults(deps, done)),
    { bot: done.bot.name, answer: text.trim() || NO_WRITTEN_ANSWER },
  ]);
  let started: { id: string };
  try {
    started = await deps.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          spaceId: done.spaceId,
          botId: bot.id,
          threadId: bot.thread!.id,
          userId: done.userId,
          prompt,
          status: "queued",
        },
      });
      return tx.run.create({
        data: {
          spaceId: done.spaceId,
          botId: bot.id,
          threadId: bot.thread!.id,
          taskId: task.id,
          userId: done.userId,
          status: "queued",
          trigger: "routine",
          routineId: done.routineId,
          routineStepId: next.id,
          stepOfRunId: done.id,
          ...routineRunModelPin(routine),
        },
        select: { id: true },
      });
    });
  } catch (error) {
    // stepOfRunId is unique: another delivery of this job already started the step.
    if (isUniqueViolation(error)) return;
    throw error;
  }
  await deps.jobs.enqueue(runContinueJob(started.id));
}
