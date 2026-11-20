import { runContinueJob } from "@corvo/adapter-kit";
import { HANDOFF_REASON_MAX_LENGTH, MessageBlock } from "@corvo/contracts";
import {
  BOT_MESSAGE_MAX_LENGTH,
  botMessageContext,
  botMessageHopExhausted,
  nextBotMessageHop,
  renderBotGroupDirectory,
  renderGroupMembersContext,
  resolveBotAddress,
} from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  IsolationError,
  lockOwnedGroup,
  touchGroupUpdatedAt,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { audienceSelect, personMayTalkTo } from "./agent-audience.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { alreadyAnsweringReason, alreadyAnsweringRoot } from "./group-root.js";

export async function handoffToGroupBot(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs">,
  run: {
    id: string;
    spaceId: string;
    threadId: string;
    botId: string;
    userId: string;
  },
  groupId: string,
  input: {
    bot_id?: string;
    confirm_name?: string;
    message: string;
    reason?: string;
    /** The step of the sender's plan this stage carries. */
    planStep?: string;
    deliveryKey?: string;
  },
  /** Who may reach a group the sender does not belong to: a squad-routing bot in a run its owner started. */
  authority: { squadRouting: boolean; ownerStarted: boolean },
) {
  const text = input.message.trim();
  if (!text || text.length > BOT_MESSAGE_MAX_LENGTH) {
    return { error: `message must contain 1 to ${BOT_MESSAGE_MAX_LENGTH} characters` } as const;
  }
  const reason = input.reason?.trim() || undefined;
  if (reason && reason.length > HANDOFF_REASON_MAX_LENGTH) {
    return {
      error: `reason must contain at most ${HANDOFF_REASON_MAX_LENGTH} characters`,
    } as const;
  }
  const committed = await deps.prisma.$transaction(async (tx) => {
    try {
      await lockOwnedGroup(tx, run, groupId);
    } catch (error) {
      if (error instanceof IsolationError)
        return { error: "group is no longer available" } as const;
      throw error;
    }
    const group = await tx.chatGroup.findFirst({
      where: { id: groupId, spaceId: run.spaceId, archivedAt: null },
      include: {
        thread: { select: { id: true } },
        members: {
          where: { bot: { archivedAt: null } },
          include: { bot: { select: { id: true, name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!group?.thread) return { error: "group is no longer available" } as const;
    const targetThreadId = group.thread.id;
    // Match message_bot's lock order and serialize source cancellation/clearing with delivery.
    for (const threadId of [...new Set([run.threadId, targetThreadId])].sort()) {
      await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
    }
    const activeSource = await tx.run.findFirst({
      where: {
        id: run.id,
        spaceId: run.spaceId,
        threadId: run.threadId,
        botId: run.botId,
        userId: run.userId,
        status: "running",
      },
      select: {
        id: true,
        sourceMessageId: true,
        thread: { select: { groupId: true } },
        sourceMessage: { select: { blocks: true } },
      },
    });
    if (!activeSource) return { error: "source run is no longer active" } as const;
    const inGroup = targetThreadId === run.threadId;
    if (!inGroup && activeSource.thread.groupId) {
      return { error: "group handoffs must stay in the current group" } as const;
    }
    const mayRoute = authority.squadRouting && authority.ownerStarted;
    // A run already in this channel's thread was woken here (a member, or an agent a person named),
    // so only a run reaching in from elsewhere has to be a member.
    if (!mayRoute && !inGroup && !group.members.some((member) => member.bot.id === run.botId)) {
      return { error: "source bot is no longer a group member" } as const;
    }

    // A group stage has one owner; an outside turn can send several independent tasks.
    const deliveryKey = `group-handoff:${inGroup ? run.id : (input.deliveryKey ?? run.id)}`;
    const existing = await tx.message.findUnique({
      where: { threadId_clientNonce: { threadId: targetThreadId, clientNonce: deliveryKey } },
      select: {
        id: true,
        sourceRuns: {
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { id: true, botId: true },
        },
      },
    });
    if (existing) {
      const nextRun = existing.sourceRuns[0];
      const event = await tx.event.findFirst({
        where: {
          threadId: targetThreadId,
          type: "group.handoff",
          payload: { path: ["messageId"], equals: existing.id },
        },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      if (!nextRun || !event) return { error: "recorded handoff is incomplete" } as const;
      return {
        ok: true,
        botId: nextRun.botId,
        runId: nextRun.id,
        eventSeq: event.seq,
        threadId: targetThreadId,
        inGroup,
        groupName: group.name,
      } as const;
    }

    // Members first; then any other agent of the space, who answers this stage as a guest.
    const members = group.members.map((member) => member.bot);
    const address = { botId: input.bot_id, name: input.confirm_name };
    const target =
      resolveBotAddress(members, address) ??
      resolveBotAddress(
        await tx.bot.findMany({
          where: {
            spaceId: run.spaceId,
            archivedAt: null,
            id: { notIn: members.map((member) => member.id) },
          },
          select: { id: true, name: true },
        }),
        address,
      );
    if (!target) return { error: "handoff target is not an agent of this space" } as const;
    const targetId = target.id;
    if (targetId === run.botId) return { error: "cannot hand off to yourself" } as const;
    // One voice per message: an agent already woken for this one answers it itself.
    if (
      inGroup &&
      (await alreadyAnsweringRoot(
        tx,
        { threadId: run.threadId, sourceMessageId: activeSource.sourceMessageId },
        targetId,
      ))
    ) {
      return { error: alreadyAnsweringReason(target.name) } as const;
    }
    // The channel shows the stage to everyone in it, so the agent must take the person behind the
    // run as its own audience; consulting it for them goes through message_bot, privately.
    const targetRow = await tx.bot.findFirst({
      where: { id: targetId, spaceId: run.spaceId, archivedAt: null },
      select: audienceSelect,
    });
    if (
      !targetRow ||
      !(await personMayTalkTo(tx, { spaceId: run.spaceId, userId: run.userId }, targetRow))
    ) {
      return {
        error: `${target.name} works only with some people. Ask it with message_bot instead, or tell the person.`,
      } as const;
    }

    let sourceBlocks: MessageBlock[] = [];
    if (activeSource.sourceMessage) {
      const parsedSource = MessageBlock.array().safeParse(activeSource.sourceMessage.blocks);
      if (!parsedSource.success) {
        return { error: "cannot verify the group handoff chain" } as const;
      }
      sourceBlocks = parsedSource.data;
    }
    const sourceHandoff = sourceBlocks.find(
      (block): block is Extract<MessageBlock, { kind: "handoff" }> => block.kind === "handoff",
    );
    if (sourceHandoff?.fromBotId === targetId) {
      return {
        error:
          "do not hand this stage back to its sender; post the result in the shared thread instead",
      } as const;
    }
    const hop = nextBotMessageHop(sourceHandoff?.hop ?? botMessageContext(sourceBlocks)?.hop);
    if (botMessageHopExhausted(hop)) {
      return {
        error:
          "group handoff limit reached for this chain; finish the current stage in the shared thread instead",
      } as const;
    }

    const handoffBlock: MessageBlock = {
      kind: "handoff",
      fromBotId: run.botId,
      toBotId: targetId,
      text,
      ...(reason ? { reason } : {}),
      hop,
      ...(input.planStep?.trim() ? { planStep: input.planStep.trim().slice(0, 20) } : {}),
      // A router outside the group delegates and waits for the answer; a member passes the baton.
      ...(inGroup ? {} : { returnsToSender: true as const }),
      ...(!inGroup && authority.squadRouting && authority.ownerStarted
        ? { routedWithAuthority: true as const }
        : {}),
    };
    const message = await createThreadMessageInTransaction(tx, {
      threadId: targetThreadId,
      role: "bot",
      blocks: [handoffBlock],
      botId: run.botId,
      runId: inGroup ? run.id : undefined,
      clientNonce: deliveryKey,
    });
    const task = await tx.task.create({
      data: {
        spaceId: run.spaceId,
        botId: targetId,
        threadId: targetThreadId,
        userId: run.userId,
        prompt: text,
        status: "queued",
      },
    });
    const nextRun = await tx.run.create({
      data: {
        spaceId: run.spaceId,
        botId: targetId,
        threadId: targetThreadId,
        taskId: task.id,
        userId: run.userId,
        status: "queued",
        trigger: "follow_up",
        sourceMessageId: message.id,
      },
    });
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: targetThreadId,
      botId: run.botId,
      type: "group.handoff",
      runId: inGroup ? run.id : undefined,
      payload: {
        messageId: message.id,
        fromBotId: run.botId,
        toBotId: targetId,
        text,
        ...(reason ? { reason } : {}),
      },
    });
    await touchGroupUpdatedAt(tx, groupId);
    return {
      ok: true,
      botId: targetId,
      runId: nextRun.id,
      eventSeq: event.seq,
      threadId: targetThreadId,
      inGroup,
      groupName: group.name,
    } as const;
  });
  if ("error" in committed) return committed;
  await deps.events.notify(committed.threadId, committed.eventSeq).catch((error) => {
    getLogger().error("group handoff realtime notification", error);
  });
  await deps.jobs.enqueue(runContinueJob(committed.runId)).catch((error) => {
    // The queued run is durable and the job reconciler will repair a missed immediate wake.
    getLogger().error("group handoff enqueue", error);
  });
  return {
    ok: true,
    botId: committed.botId,
    runId: committed.runId,
    groupId,
    groupName: committed.groupName,
    note: committed.inGroup
      ? "Handoff recorded. End this turn without narrating it; the next bot owns the next stage."
      : "Handoff recorded in the selected group. The next bot will reply there. Continue any independent work.",
  };
}

export async function loadGroupContext(
  prisma: PrismaClient,
  groupId: string,
  self: { id: string; name: string },
): Promise<string | undefined> {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        where: { bot: { archivedAt: null } },
        include: {
          bot: { select: { id: true, name: true, title: true, description: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!group) return undefined;
  return renderGroupMembersContext(
    group.name,
    group.members.map((member) => member.bot),
    self,
  );
}

type DirectoryGroup = {
  id: string;
  name: string;
  purpose: string | null;
  members: { id: string; name: string }[];
};

/** Only the current bot's active groups in the same space are discoverable. */
export async function loadBotGroups(
  prisma: PrismaClient,
  actor: { botId: string; userId: string; spaceId: string },
  /** `allGroups`: a squad-routing bot sees every active group in this space. */
  options: { allGroups?: boolean } = {},
): Promise<DirectoryGroup[]> {
  const groups = await prisma.chatGroup.findMany({
    where: {
      spaceId: actor.spaceId,
      archivedAt: null,
      members: options.allGroups
        ? { some: { bot: { archivedAt: null } } }
        : { some: { botId: actor.botId, bot: { archivedAt: null } } },
      thread: { isNot: null },
    },
    select: {
      id: true,
      name: true,
      purpose: true,
      members: {
        where: { bot: { archivedAt: null } },
        select: { bot: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 40,
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    purpose: group.purpose,
    members: group.members.map((member) => member.bot),
  }));
}

/** When each bot last had a run in the space; bots that never ran are absent. */
export async function lastRunAtByBot(
  prisma: PrismaClient,
  spaceId: string,
  botIds: readonly string[],
): Promise<Map<string, Date>> {
  const rows = await prisma.run.groupBy({
    by: ["botId"],
    where: { spaceId, botId: { in: [...botIds] } },
    _max: { createdAt: true },
  });
  return new Map(
    rows.flatMap((row) => (row._max.createdAt ? [[row.botId, row._max.createdAt] as const] : [])),
  );
}

export async function loadBotGroupDirectory(
  prisma: PrismaClient,
  actor: { botId: string; userId: string; spaceId: string },
  options: { allGroups?: boolean } = {},
): Promise<string | undefined> {
  return renderBotGroupDirectory(await loadBotGroups(prisma, actor, options), {
    routing: options.allGroups,
  });
}
