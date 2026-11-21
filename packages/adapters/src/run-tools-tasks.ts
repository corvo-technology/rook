import { recordSurfacedItem } from "@corvo/db";
import {
  desktopProtectionGuardMessage,
  protectedComputerLifecycleRefusal,
} from "./desktop-command-guard.js";
import { clampEscalationReason } from "./model-routing.js";
import { setPlanCard, updatePlanCard } from "./plan-card.js";
import type { RunContext } from "./run-context.js";
import { isSubagentToolExecution } from "./run-effects.js";
import { publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";
import {
  cancelScheduleFromTool,
  commandWatchFromTool,
  compactScheduleInput,
  createScheduleFromTool,
  isScheduleValueProvided,
  listSchedulesFromTool,
  updateScheduleFromTool,
} from "./schedule-tools.js";
import {
  addScratchpadItemFromTool,
  completeScratchpadItemFromTool,
  listScratchpadItemsFromTool,
  removeScratchpadItemFromTool,
  updateScratchpadItemFromTool,
} from "./scratchpad-tools.js";
import {
  skillCreateFromTool,
  skillDeleteFromTool,
  skillReadFromTool,
  skillUpdateFromTool,
} from "./skill-tools.js";
import { installStoreSkillFromTool, listStoreSkills } from "./store-skills.js";
import { taskCatalogFromTool } from "./task-catalog.js";
import {
  commentTicket,
  createTicket,
  getTicket,
  listBoardTickets,
  updateTicket,
} from "./ticket-tools.js";

/** The `fields` argument as name and text pairs; anything else a model sends is ignored. */
function ticketFieldsArg(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([name, text]) => [name, text === null ? "" : String(text)]),
  );
}

/**
 * Whether schedule_list and schedule_update reach every agent's routines, not only this bot's
 * own. It follows the same gate as the bot management tools: the switch is read live, the run
 * is one the owner started, and a write is refused once outside content entered the run.
 */
async function canManageFleetRoutines(
  ctx: RunContext,
  call: ToolCall,
  write: boolean,
): Promise<boolean> {
  if (isSubagentToolExecution(call.executionId) || !ctx.source.ownerStartedRun) return false;
  const live = await ctx.deps.prisma.bot.findUnique({
    where: { id: ctx.bot.id },
    select: { fleetManagement: true },
  });
  if (!live?.fleetManagement) return false;
  return !write || !(await ctx.trust.receivedOutsideMessage());
}

/** The task catalog, scratchpad, ticket board, schedules and skills. */
/** A tool argument that should be a list of strings; anything else is left out. */
function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((item) => String(item)) : undefined;
}

export const taskTools: ToolHandlers = {
  async task_catalog(ctx) {
    const { deps, run, bot, thread } = ctx;
    return taskCatalogFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(thread.groupId ? { threadId: thread.id } : {}),
      tools: ctx.tools.offered,
    });
  },
  async scratchpad_list(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return listScratchpadItemsFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      includeDone: Boolean(args.includeDone),
    });
  },
  async scratchpad_add(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const created = await addScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      title: String(args.title ?? ""),
      status: args.status ? String(args.status) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
    });
    return call.finish(created);
  },
  async scratchpad_update(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const updated = await updateScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
      title: args.title !== undefined ? String(args.title) : undefined,
      status: args.status !== undefined ? String(args.status) : undefined,
      notes: args.notes !== undefined ? String(args.notes) : undefined,
    });
    return call.finish(updated);
  },
  async scratchpad_complete(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const completed = await completeScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
    });
    return call.finish(completed);
  },
  async scratchpad_remove(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const removed = await removeScratchpadItemFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      itemId: String(args.itemId ?? ""),
    });
    return call.finish(removed);
  },
  async board_tickets(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await listBoardTickets(deps, {
        spaceId: run.spaceId,
        status: args.status !== undefined ? String(args.status) : undefined,
        assigneeBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
        cursor: args.cursor !== undefined ? String(args.cursor) : undefined,
      }),
    );
  },
  async ticket_get(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await getTicket(deps, {
        spaceId: run.spaceId,
        ref: String(args.ref ?? ""),
      }),
    );
  },
  async ticket_create(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const created = await createTicket(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      title: String(args.title ?? ""),
      description: args.description !== undefined ? String(args.description) : undefined,
      priority: args.priority !== undefined ? String(args.priority) : undefined,
      ownerBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
      acceptanceCriteria:
        args.acceptanceCriteria !== undefined ? String(args.acceptanceCriteria) : undefined,
      blockedBy: stringList(args.blockedBy),
    });
    // The task shows in the conversation as a card, so people see what the agent added.
    if ("ticket" in created && created.ticket) {
      await publishMessage(deps, run, "bot", [
        { kind: "ticket", ref: created.ticket.ref, title: created.ticket.title },
      ]).catch(() => undefined);
    }
    return call.finish(created);
  },
  async ticket_update(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await updateTicket(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        id: String(args.id ?? ""),
        title: args.title !== undefined ? String(args.title) : undefined,
        description: args.description !== undefined ? String(args.description) : undefined,
        priority: args.priority !== undefined ? String(args.priority) : undefined,
        status: args.status !== undefined ? String(args.status) : undefined,
        ownerBotId: args.ownerBotId !== undefined ? String(args.ownerBotId) : undefined,
        fields: ticketFieldsArg(args.fields),
        acceptanceCriteria:
          args.acceptanceCriteria !== undefined ? String(args.acceptanceCriteria) : undefined,
        blockedBy: stringList(args.blockedBy),
        remaining: args.remaining !== undefined ? String(args.remaining) : undefined,
      }),
    );
  },
  async ticket_comment(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    return call.finish(
      await commentTicket(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        id: String(args.id ?? ""),
        body: String(args.body ?? ""),
      }),
    );
  },
  async schedule_create(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const command = commandWatchFromTool(args.watch);
    const refusal = command === undefined ? undefined : protectedComputerLifecycleRefusal(command);
    if (ctx.computer.graphical && refusal)
      return call.finish({ error: desktopProtectionGuardMessage(refusal) });
    const created = await createScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      threadId: thread.id,
      name: String(args.name ?? ""),
      prompt: String(args.prompt ?? ""),
      timezone: args.timezone ? String(args.timezone) : undefined,
      schedule: compactScheduleInput({
        cron: args.cron,
        every: args.every,
        unit: args.unit,
        runAt: args.runAt,
        delayMinutes: args.delayMinutes,
        delaySeconds: args.delaySeconds,
        startAt: args.startAt,
        watch: args.watch,
        onMessage: args.onMessage,
      }),
    });
    return call.finish(created);
  },
  async schedule_update(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const fleet = await canManageFleetRoutines(ctx, call, true);
    return call.finish(
      await updateScheduleFromTool(deps, {
        spaceId: run.spaceId,
        botId: bot.id,
        userId: run.userId,
        threadId: thread.id,
        ...(fleet ? { fleet } : thread.groupId ? { scopeThreadId: thread.id } : {}),
        routineId: String(args.routineId ?? ""),
        name: isScheduleValueProvided(args.name) ? String(args.name) : undefined,
        prompt: isScheduleValueProvided(args.prompt) ? String(args.prompt) : undefined,
        active: typeof args.active === "boolean" ? args.active : undefined,
        timezone: isScheduleValueProvided(args.timezone) ? String(args.timezone) : undefined,
        schedule: compactScheduleInput({
          cron: args.cron,
          every: args.every,
          unit: args.unit,
          runAt: args.runAt,
          delayMinutes: args.delayMinutes,
          delaySeconds: args.delaySeconds,
          startAt: args.startAt,
        }),
      }),
    );
  },
  async schedule_list(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const fleet = await canManageFleetRoutines(ctx, call, false);
    return listSchedulesFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(fleet ? { fleet } : thread.groupId ? { threadId: thread.id } : {}),
    });
  },
  async workflow_stop(_ctx, call) {
    return call.finish({
      ok: true,
      note: "The workflow ends after this step. Say why in your answer.",
    });
  },
  async pass(ctx, call) {
    ctx.state.passed = true;
    return call.finish({ ok: true, note: "Passed. End your turn now without writing anything." });
  },
  async note_surfaced(ctx, call) {
    const { args } = call;
    const noted = await recordSurfacedItem(ctx.deps.prisma, {
      spaceId: ctx.run.spaceId,
      botId: ctx.bot.id,
      threadId: ctx.thread.id,
      key: String(args.key ?? ""),
      fingerprint: args.version ? String(args.version) : null,
      summary: String(args.summary ?? ""),
      runId: ctx.run.id,
    });
    return call.finish("error" in noted ? noted : { ok: true, key: noted.key });
  },
  async request_stronger_model(ctx, call) {
    const { state } = ctx;
    if (!state.strongerTier || state.escalation || ctx.run.tierEscalations > 0) {
      return call.finish({ error: "A stronger model is not available for this run." });
    }
    state.escalation = { reason: clampEscalationReason(call.args.reason) };
    // The turn ends here: a stronger model picks the run up from what is already in the chat.
    ctx.abortController.abort();
    return call.finish({ ok: true, note: "A stronger model will continue. Stop now." });
  },
  async schedule_cancel(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    const cancelled = await cancelScheduleFromTool(deps, {
      spaceId: run.spaceId,
      botId: bot.id,
      userId: run.userId,
      ...(thread.groupId ? { threadId: thread.id } : {}),
      routineId: args.routineId ? String(args.routineId) : undefined,
      name: args.name ? String(args.name) : undefined,
    });
    return call.finish(cancelled);
  },
  async skill_read(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return skillReadFromTool(
      deps.prisma,
      {
        spaceId: run.spaceId,
        userId: run.userId,
      },
      {
        name: args.name ? String(args.name) : undefined,
        skillId: args.skillId ? String(args.skillId) : undefined,
      },
    );
  },
  async skill_create(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillCreateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          description: args.description ? String(args.description) : undefined,
          body: args.body ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async plan_set(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(await setPlanCard(deps, run, call.args));
  },
  async plan_update(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(await updatePlanCard(deps, run, call.args));
  },
  async store_skills(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(
      await listStoreSkills(deps, { spaceId: run.spaceId, userId: run.userId }, call.args),
    );
  },
  async skill_install(ctx, call) {
    const { deps, run } = ctx;
    return call.finish(
      await installStoreSkillFromTool(
        deps,
        { spaceId: run.spaceId, userId: run.userId },
        call.args,
      ),
    );
  },
  async skill_update(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillUpdateFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
          newName: args.newName ? String(args.newName) : undefined,
          description: args.description !== undefined ? String(args.description) : undefined,
          body: args.body !== undefined ? String(args.body) : undefined,
          content: args.content ? String(args.content) : undefined,
        },
      ),
    );
  },
  async skill_delete(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    return call.finish(
      await skillDeleteFromTool(
        deps.prisma,
        {
          spaceId: run.spaceId,
          userId: run.userId,
        },
        {
          name: args.name ? String(args.name) : undefined,
          skillId: args.skillId ? String(args.skillId) : undefined,
        },
      ),
    );
  },
};
