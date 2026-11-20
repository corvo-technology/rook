import type { Prisma, PrismaClient } from "./client.js";
import { appendEventInTransaction } from "./events.js";
import { RUN_TURN_CHECKPOINT_KIND } from "./run-turn-checkpoint.js";
import { BranchError, loadBranchState, visibleMessageFilter } from "./thread-branches.js";

type Db = PrismaClient | Prisma.TransactionClient;

/** Effects an agent has started or finished; an `intended` or `denied` one never touched anything. */
const EFFECT_STATUSES = ["executing", "completed", "uncertain"];

/** Whether the replies on the visible line after `forkSeq` took any action outside the chat. */
async function hadExternalEffects(
  db: Db,
  threadId: string,
  visible: Prisma.MessageWhereInput,
  forkSeq: number,
): Promise<boolean> {
  const rows = await db.message.findMany({
    where: { threadId, AND: [visible], seq: { gt: forkSeq }, runId: { not: null } },
    select: { runId: true },
  });
  const runIds = [...new Set(rows.flatMap((row) => (row.runId ? [row.runId] : [])))];
  if (runIds.length === 0) return false;
  const count = await db.externalEffect.count({
    where: {
      runId: { in: runIds },
      status: { in: EFFECT_STATUSES },
      kind: { not: RUN_TURN_CHECKPOINT_KIND },
    },
  });
  return count > 0;
}

export interface ForkInput {
  spaceId: string;
  threadId: string;
  botId: string;
  /** The new line keeps the messages up to and including this seq. */
  forkSeq: number;
}

/**
 * Starts a branch that keeps everything up to `forkSeq` and leaves the rest of the visible line
 * where it is, then makes it the active one. The caller holds the thread row lock and has checked
 * that no run is in progress. Returns whether the line it left had taken actions outside the chat.
 */
export async function forkThreadBranch(
  tx: Prisma.TransactionClient,
  input: ForkInput,
): Promise<{ branchId: string; abandonedHadEffects: boolean; eventSeq: number }> {
  const thread = await tx.thread.findUniqueOrThrow({
    where: { id: input.threadId },
    select: { historyCompactedUpToSeq: true },
  });
  // A summary that already swallowed the messages being left would carry them into the new line.
  if (thread.historyCompactedUpToSeq !== null && input.forkSeq < thread.historyCompactedUpToSeq) {
    throw new BranchError("compacted", "This message is too far back to branch from.");
  }
  const state = await loadBranchState(tx, input.threadId);
  const visible = visibleMessageFilter(state.segments, state.branches.length > 0);
  const effects = await hadExternalEffects(tx, input.threadId, visible, input.forkSeq);
  // A branch with no message of its own before the fork is a sibling of its parent, not its child.
  const byId = new Map(state.branches.map((branch) => [branch.id, branch]));
  let parent = state.activeBranchId;
  while (parent !== null) {
    const branch = byId.get(parent);
    if (!branch || branch.forkSeq < input.forkSeq) break;
    parent = branch.parentBranchId;
  }
  const branch = await tx.threadBranch.create({
    data: {
      threadId: input.threadId,
      spaceId: input.spaceId,
      parentBranchId: parent,
      forkSeq: input.forkSeq,
    },
    select: { id: true },
  });
  await tx.thread.update({ where: { id: input.threadId }, data: { activeBranchId: branch.id } });
  const event = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: input.botId,
    type: "thread.branch.changed",
    payload: { branchId: branch.id, forkSeq: input.forkSeq },
  });
  return { branchId: branch.id, abandonedHadEffects: effects, eventSeq: event.seq };
}

/** Shows another version of the conversation; null is the original line. */
export async function switchThreadBranch(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string; botId: string; branchId: string | null },
): Promise<{ eventSeq: number }> {
  let forkSeq = 0;
  if (input.branchId !== null) {
    const branch = await tx.threadBranch.findFirst({
      where: { id: input.branchId, threadId: input.threadId },
      select: { forkSeq: true },
    });
    if (!branch) throw new BranchError("not_found", "That version no longer exists.");
    forkSeq = branch.forkSeq;
  }
  await tx.thread.update({
    where: { id: input.threadId },
    data: {
      activeBranchId: input.branchId,
      // A summary written on the line being left would describe messages that are no longer in view.
      historyCompactedUpToSeq: null,
      historyCompactionSummary: null,
      historyCompactionGeneration: { increment: 1 },
    },
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: input.botId,
    type: "thread.branch.changed",
    payload: { branchId: input.branchId, forkSeq },
  });
  return { eventSeq: event.seq };
}
