import { MuteDurationSchema } from "@corvo/contracts";
import { clearMute, setMute } from "@corvo/db";
import type { ToolHandlers } from "./run-tool-gate.js";
import { taskTools } from "./run-tools-tasks.js";

/**
 * Notification steering. `notify_priority` is how a background run marks its own push; it only
 * records the mark, and notifyRun reads it when the run finishes. `notify_control` is the person's
 * voice in chat: it changes their own mutes and one routine's rhythm, and only for a run they
 * started and that no outside content has reached.
 */
export const notifyTools: ToolHandlers = {
  async notify_priority(ctx, call) {
    const priority = call.args.priority;
    if (priority !== "urgent" && priority !== "low") {
      return call.finish({ error: 'priority must be "urgent" or "low".' });
    }
    await ctx.deps.prisma.run.update({
      where: { id: ctx.runId },
      data: { notifyPriority: priority },
    });
    return call.finish({ ok: true, priority });
  },
  async notify_control(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    if (!ctx.source.ownerStartedRun || (await ctx.trust.receivedOutsideMessage())) {
      return call.finish({ error: "Only the person can change their notifications, in chat." });
    }
    const person = { spaceId: run.spaceId, userId: run.userId };
    const target = call.args.scope === "thread" ? { threadId: thread.id } : { botId: bot.id };
    if (call.args.action === "mute") {
      const duration = MuteDurationSchema.safeParse(call.args.duration);
      if (!duration.success) {
        return call.finish({ error: "duration must be hour, tomorrow or forever." });
      }
      const mute = await setMute(deps.prisma, person, target, duration.data);
      return call.finish({ ok: true, until: mute.until });
    }
    if (call.args.action === "unmute") {
      await clearMute(deps.prisma, person, target);
      return call.finish({ ok: true });
    }
    if (call.args.action === "frequency") {
      // The routine update path itself, so its scoping and checks apply; only the timing passes.
      const { routineId, cron, every, unit } = call.args;
      return taskTools.schedule_update?.(ctx, { ...call, args: { routineId, cron, every, unit } });
    }
    return call.finish({ error: "action must be mute, unmute or frequency." });
  },
};
