import { isBackgroundRunTrigger, redactSecrets } from "@corvo/core";
import { getLogger } from "@corvo/logging";
import {
  connectAgent,
  messageConnectedAgent,
  respondAgentConnection,
} from "./agent-connections.js";
import { messageBot } from "./bot-messages.js";
import { endCallFromTool, requestUserCall } from "./call-request.js";
import { handoffToGroupBot } from "./group-handoff.js";
import { updatePlanCard } from "./plan-card.js";
import type { RunContext } from "./run-context.js";
import { isSubagentToolExecution } from "./run-effects.js";
import { publishMessage } from "./run-messages.js";
import {
  canPublishDurableProgress,
  flushProgress,
  publishMidTurnNarration,
} from "./run-progress.js";
import type { ToolHandlers } from "./run-tool-gate.js";
import {
  clampUserProgressMessage,
  isProgressMessageTruncated,
  messageUserMaxLength,
  SAY_NOW_MAX_LENGTH,
  sayNowAllowed,
  sayNowClientNonce,
  userProgressClientNonce,
} from "./user-progress.js";

/**
 * A routine is the owner's own schedule, so its runs route like a run the owner started. So is the
 * answer to a handoff the bot itself routed with the owner's authority, which lets it send the next
 * stage on. Webhook and channel runs do not, and any run that received an outside message is
 * refused per call.
 */
export function mayRouteWithoutOwner(
  trigger: string,
  ownerStartedRun: boolean,
  peerMessage?: { continuesRouting?: boolean } | null,
): boolean {
  return (
    ownerStartedRun ||
    trigger === "routine" ||
    (trigger === "bot_message" && peerMessage?.continuesRouting === true)
  );
}

/**
 * Whether this call may hand off to a group its bot is not in. Every condition is checked per call:
 * the owner can turn the switch off mid-run, a helper never routes, and outside text that reached
 * the run could steer where work goes.
 */
export async function squadRoutingAuthority(
  ctx: Pick<RunContext, "deps" | "run" | "source" | "trust">,
  executionId: string,
) {
  const ownerStarted = mayRouteWithoutOwner(
    ctx.run.trigger,
    ctx.source.ownerStartedRun,
    ctx.source.peerMessage,
  );
  if (!ownerStarted || isSubagentToolExecution(executionId)) {
    return { squadRouting: false, ownerStarted };
  }
  const live = await ctx.deps.prisma.bot.findUnique({
    where: { id: ctx.run.botId },
    select: { squadRouting: true },
  });
  const squadRouting = Boolean(live?.squadRouting) && !(await ctx.trust.receivedOutsideMessage());
  return { squadRouting, ownerStarted };
}

/** Mark the plan step a stage carries as running once it has been sent; never fails the send. */
export async function startPlanStep(
  ctx: Pick<RunContext, "deps" | "run" | "bot" | "thread">,
  step: unknown,
) {
  const id = typeof step === "string" ? step.trim() : "";
  if (!id) return;
  try {
    await updatePlanCard(
      ctx.deps,
      { spaceId: ctx.run.spaceId, threadId: ctx.thread.id, botId: ctx.bot.id },
      { updates: [{ step: id, status: "running" }] },
    );
  } catch (error) {
    getLogger().error("plan step start", error);
  }
}

/** Messages to the user, other bots and connected agents, and calls. */
export const messagingTools: ToolHandlers = {
  async call_user(ctx, call) {
    const { deps, run, thread } = ctx;
    const { args } = call;
    if (
      ctx.source.messagingChannelRun ||
      thread.groupId ||
      ctx.source.voiceCall ||
      isBackgroundRunTrigger(run.trigger)
    ) {
      return call.finish({ error: "Calls require a one-to-one chat." });
    }
    return call.finish(
      await requestUserCall(deps, run, {
        reason: String(args.reason ?? ""),
        opening: String(args.opening ?? ""),
      }),
    );
  },
  async end_call(ctx, call) {
    const { deps, run, bot, thread } = ctx;
    const { args } = call;
    return call.finish(
      await endCallFromTool(
        deps,
        run,
        thread.id,
        bot.id,
        args,
        ctx.source.callClientNonce,
        ctx.source.callEndRun,
      ),
    );
  },
  async request_takeover() {
    return { ok: true };
  },
  async run_subagent(_ctx, call) {
    const { args } = call;
    return {
      ok: true,
      result: String(args.task ?? "done."),
    };
  },
  async message_user(ctx, call) {
    const { deps, run } = ctx;
    const { args } = call;
    const { reply } = ctx.state;
    const rawMessage = redactSecrets(String(args.message ?? ""), ctx.secrets);
    const maxLength = messageUserMaxLength();
    const text = clampUserProgressMessage(rawMessage, maxLength);
    if (!text) return call.finish({ error: "message is required" });
    const truncated = isProgressMessageTruncated(rawMessage, maxLength);
    await flushProgress(ctx);
    await publishMidTurnNarration(ctx);
    if (!canPublishDurableProgress(reply)) {
      return call.finish({
        ok: true,
        note: "This update was not posted. The turn is still fresh, or the chat already has enough interim messages for this run. Do not send more progress updates — keep working and put everything in your final reply.",
      });
    }
    await publishMessage(
      deps,
      run,
      "bot",
      [{ kind: "text", text }],
      true,
      userProgressClientNonce(run.id, reply.midTurnProgressCount++),
    );
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
    return call.finish(
      truncated
        ? {
            ok: true,
            truncated: true,
            note: `This progress update was cut off at ${maxLength} characters and the user only saw the truncated version above — it did NOT deliver your full content. message_user is for short interim beats only, never the final answer. Put your complete answer in your normal final reply instead of relying on this truncated update.`,
          }
        : { ok: true },
    );
  },
  async say_now(ctx, call) {
    const { deps, run } = ctx;
    const { reply } = ctx.state;
    // Checked per call, not only when the tool is offered: a helper run or a changed run never posts.
    if (
      !sayNowAllowed({
        ownerStartedRun: ctx.source.ownerStartedRun,
        messagingChannelRun: ctx.source.messagingChannelRun,
        voiceCall: ctx.source.voiceCall,
        visitorRun: false,
      }) ||
      isSubagentToolExecution(call.executionId)
    ) {
      return call.finish({ error: "say_now is not available in this run." });
    }
    if (reply.sayNowText !== undefined) {
      return call.finish({ error: "say_now was already used in this run. Keep working." });
    }
    const text = redactSecrets(String(call.args.message ?? ""), ctx.secrets).trim();
    if (!text) return call.finish({ error: "message is required" });
    if (text.length > SAY_NOW_MAX_LENGTH) {
      return call.finish({
        error: `message is over ${SAY_NOW_MAX_LENGTH} characters. Call say_now again with one shorter line.`,
      });
    }
    await flushProgress(ctx);
    reply.sayNowText = text;
    await publishMessage(
      deps,
      run,
      "bot",
      [{ kind: "text", text }],
      true,
      sayNowClientNonce(run.id),
    );
    reply.midTurnUserTexts.push(text);
    reply.publishedMidTurnUserMessage = true;
    return call.finish({ ok: true });
  },
  async message_bot(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args, effectKey } = call;
    const sent = await messageBot(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        bot_id: args.bot_id ? String(args.bot_id) : undefined,
        confirm_name: args.confirm_name ? String(args.confirm_name) : undefined,
        message: redactSecrets(String(args.message ?? ""), ctx.secrets),
        intent: args.intent as "request" | "result" | "question" | "status" | "fyi" | undefined,
        planStep: typeof args.plan_step === "string" ? args.plan_step : undefined,
        deliveryKey: effectKey,
      },
    );
    if (!sent.ok) return call.finish({ error: sent.error });
    if (args.intent === undefined || args.intent === "request") {
      await startPlanStep(ctx, args.plan_step);
    }
    return call.finish({
      ok: true,
      botId: sent.botId,
      name: sent.name,
      note: sent.note,
    });
  },
  async connect_agent(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const result = await connectAgent(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      { address: args.address ? String(args.address) : undefined },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async respond_agent_connection(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args } = call;
    const result = await respondAgentConnection(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        accept: Boolean(args.accept),
        connectionId: String(args.connection_id ?? ""),
        connectionVersion: Number(args.connection_version ?? 0),
      },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async message_agent(ctx, call) {
    const { deps, run, bot } = ctx;
    const { args, effectKey } = call;
    const result = await messageConnectedAgent(
      deps,
      { ...run, sourceMessageId: run.sourceMessageId },
      { id: bot.id, name: bot.name },
      {
        address: args.address ? String(args.address) : undefined,
        message: redactSecrets(String(args.message ?? ""), ctx.secrets),
        deliveryKey: effectKey,
      },
    );
    if (!result.ok) return call.finish({ error: result.error });
    return call.finish(result);
  },
  async handoff_to_bot(ctx, call) {
    const { deps, run, thread } = ctx;
    const { args, effectKey } = call;
    const groupId = args.group_id ? String(args.group_id).trim() : thread.groupId;
    if (!groupId) return call.finish({ error: "group_id is required outside a group chat" });
    const result = await handoffToGroupBot(
      deps,
      run,
      groupId,
      {
        bot_id: args.bot_id ? String(args.bot_id) : undefined,
        confirm_name: args.confirm_name ? String(args.confirm_name) : undefined,
        message: redactSecrets(String(args.message ?? ""), ctx.secrets),
        reason: args.reason ? redactSecrets(String(args.reason), ctx.secrets) : undefined,
        planStep: typeof args.plan_step === "string" ? args.plan_step : undefined,
        deliveryKey: effectKey,
      },
      await squadRoutingAuthority(ctx, call.executionId),
    );
    if ("ok" in result && result.ok) await startPlanStep(ctx, args.plan_step);
    if ("ok" in result && result.ok && thread.groupId) ctx.state.handedOff = true;
    return call.finish(result);
  },
};
