import { randomUUID } from "node:crypto";
import type { JobPublisher } from "@corvo/adapter-kit";
import { runContinueJob } from "@corvo/adapter-kit";
import type { Actor } from "@corvo/contracts";
import { ACTIVE_RUN_STATUSES } from "@corvo/core";
import type { Prisma, PrismaClient, ThreadEvents } from "@corvo/db";
import {
  appendEventInTransaction,
  BranchError,
  createThreadMessageInTransaction,
  forkThreadBranch,
  switchThreadBranch,
  visibleMessagesWhere,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ORPCError } from "@orpc/server";
import type { ThreadTarget } from "./thread-target.js";

/** Said in the new version when the one it left had already acted outside the chat. */
export const BRANCH_EFFECTS_NOTICE = "Actions already taken by the earlier reply were not undone.";

const RUN_IN_PROGRESS = "A reply is in progress.";

function botTarget(target: ThreadTarget) {
  // A channel has several agents answering at once, so it has no single reply to redo.
  if (target.kind !== "bot") {
    throw new ORPCError("BAD_REQUEST", { message: "Only a chat with one agent has versions." });
  }
  return target;
}

function mapBranchError(error: unknown): unknown {
  if (error instanceof BranchError) {
    return new ORPCError(error.code === "not_found" ? "NOT_FOUND" : "CONFLICT", {
      message: error.message,
    });
  }
  return error;
}

async function assertIdle(tx: Prisma.TransactionClient, threadId: string) {
  const running = await tx.run.findFirst({
    where: { threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true },
  });
  if (running) throw new ORPCError("CONFLICT", { message: RUN_IN_PROGRESS });
}

/** The one line a new version says about what the old one left done; an ordinary system message. */
export async function addEffectsNotice(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string; botId: string },
): Promise<number> {
  const blocks = [
    { kind: "meta" as const, text: BRANCH_EFFECTS_NOTICE, code: "branch_effects" as const },
  ];
  const message = await createThreadMessageInTransaction(tx, {
    threadId: input.threadId,
    role: "system",
    botId: input.botId,
    blocks,
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: input.spaceId,
    threadId: input.threadId,
    botId: input.botId,
    type: "thread.message.created",
    payload: { messageId: message.id, role: "system", blocks },
  });
  return event.seq;
}

/**
 * The first half of an edit, inside the send's own transaction (the thread row is locked): checks
 * that the person may edit the message, and starts a version that keeps everything before it. The
 * send then writes the new message on that version.
 */
export async function beginEdit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: ThreadTarget,
  messageId: string,
): Promise<{ abandonedHadEffects: boolean }> {
  const bot = botTarget(target);
  await assertIdle(tx, bot.threadId);
  const thread = await tx.thread.findUniqueOrThrow({
    where: { id: bot.threadId },
    select: { userId: true },
  });
  const visible = await visibleMessagesWhere(tx, bot.threadId);
  const message = await tx.message.findFirst({
    where: { id: messageId, threadId: bot.threadId, AND: [visible], role: "user" },
    select: { seq: true, authorUserId: true, blocks: true },
  });
  if (!message) throw new ORPCError("NOT_FOUND", { message: "That message is gone." });
  // Whoever wrote the message, or the person whose chat it is. Older messages name no author.
  if ((message.authorUserId ?? thread.userId) !== actor.userId && thread.userId !== actor.userId) {
    throw new ORPCError("FORBIDDEN", { message: "Only the author can edit this message." });
  }
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const textOnly =
    blocks.length > 0 && blocks.every((block) => (block as { kind?: unknown })?.kind === "text");
  if (!textOnly) {
    throw new ORPCError("BAD_REQUEST", { message: "Only text messages can be edited." });
  }
  try {
    const forked = await forkThreadBranch(tx, {
      spaceId: actor.spaceId,
      threadId: bot.threadId,
      botId: bot.botId,
      forkSeq: message.seq - 1,
    });
    return { abandonedHadEffects: forked.abandonedHadEffects };
  } catch (error) {
    throw mapBranchError(error);
  }
}

/**
 * Answers the person's last message again on a new version of the chat. The earlier reply stays
 * on the version it was written on. Nothing it did outside the chat is undone, and the new version
 * says so when there was any.
 */
export async function regenerateThreadReply(
  deps: { prisma: PrismaClient; events: ThreadEvents; jobs: JobPublisher },
  actor: Actor,
  target: ThreadTarget,
  input: { clientNonce?: string },
): Promise<{ runId: string }> {
  const bot = botTarget(target);
  const clientNonce = `regenerate:${input.clientNonce ?? randomUUID()}`;
  const replay = await deps.prisma.run.findFirst({
    where: { spaceId: actor.spaceId, threadId: bot.threadId, clientNonce },
    select: { id: true },
  });
  if (replay) return { runId: replay.id };
  const committed = await deps.prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${bot.threadId} FOR UPDATE`;
      await assertIdle(tx, bot.threadId);
      const visible = await visibleMessagesWhere(tx, bot.threadId);
      const source = await tx.message.findFirst({
        where: { threadId: bot.threadId, AND: [visible], role: "user" },
        orderBy: { seq: "desc" },
        select: { id: true, seq: true },
      });
      const previous = source
        ? await tx.run.findFirst({
            where: { threadId: bot.threadId, botId: bot.botId, sourceMessageId: source.id },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
              taskId: true,
              trigger: true,
              modelPinned: true,
              modelProvider: true,
              modelId: true,
              thinkingLevel: true,
              task: { select: { prompt: true } },
            },
          })
        : null;
      if (!source || !previous) {
        throw new ORPCError("CONFLICT", { message: "There is no reply to redo." });
      }
      const forked = await forkThreadBranch(tx, {
        spaceId: actor.spaceId,
        threadId: bot.threadId,
        botId: bot.botId,
        forkSeq: source.seq,
      });
      let eventSeq = forked.eventSeq;
      if (forked.abandonedHadEffects) {
        eventSeq = await addEffectsNotice(tx, {
          spaceId: actor.spaceId,
          threadId: bot.threadId,
          botId: bot.botId,
        });
      }
      const task = await tx.task.create({
        data: {
          spaceId: actor.spaceId,
          botId: bot.botId,
          threadId: bot.threadId,
          userId: actor.userId,
          prompt: previous.task.prompt,
          status: "queued",
        },
      });
      const run = await tx.run.create({
        data: {
          spaceId: actor.spaceId,
          botId: bot.botId,
          threadId: bot.threadId,
          taskId: task.id,
          // Whoever asks again starts the run; credits and limits follow them.
          userId: actor.userId,
          status: "queued",
          trigger: previous.trigger,
          clientNonce,
          sourceMessageId: source.id,
          ...(previous.modelPinned
            ? {
                modelProvider: previous.modelProvider,
                modelId: previous.modelId,
                thinkingLevel: previous.thinkingLevel,
                modelPinned: true,
              }
            : {}),
        },
        select: { id: true },
      });
      return { runId: run.id, eventSeq };
    })
    .catch((error: unknown) => {
      throw mapBranchError(error);
    });
  await deps.events.notify(bot.threadId, committed.eventSeq).catch((error) => {
    getLogger().error("thread regenerate realtime notification", error);
  });
  await deps.jobs.enqueue(runContinueJob(committed.runId)).catch((error) => {
    // The queued run is durable; the reconciler repairs a missed immediate wake.
    getLogger().error("thread regenerate enqueue", error);
  });
  return { runId: committed.runId };
}

/** Shows another version of the chat. Only while no reply is being written, so none lands on the wrong one. */
export async function switchThreadVersion(
  deps: { prisma: PrismaClient; events: ThreadEvents },
  actor: Actor,
  target: ThreadTarget,
  branchId: string | null,
): Promise<void> {
  const bot = botTarget(target);
  const { eventSeq } = await deps.prisma
    .$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${bot.threadId} FOR UPDATE`;
      await assertIdle(tx, bot.threadId);
      return switchThreadBranch(tx, {
        spaceId: actor.spaceId,
        threadId: bot.threadId,
        botId: bot.botId,
        branchId,
      });
    })
    .catch((error: unknown) => {
      throw mapBranchError(error);
    });
  await deps.events.notify(bot.threadId, eventSeq).catch((error) => {
    getLogger().error("thread branch realtime notification", error);
  });
}
