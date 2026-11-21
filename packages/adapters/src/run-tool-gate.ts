import type {
  AdapterContext,
  AgentToolExecutionObserver,
  AutoReviewRequest,
  ConnectorCall,
  ConnectorTool,
} from "@corvo/adapter-kit";
import { runContinueJob } from "@corvo/adapter-kit";
import {
  alwaysAllowTargets,
  applyJudgeDecision,
  applyToolClassification,
  approvalModeFromPreference,
  composioBatchActions,
  connectorKindFromToolName,
  connectorReadRequiresApproval,
  connectorToolRequiresApproval,
  connectorToolRisk,
  displayName,
  effectiveApprovalMode,
  newSiteOutcome,
  outboundSiteGate,
  outboundUrlLeak,
  outboundUrlsOfCall,
  planActionGate,
  redactSecrets,
  resolveActionApprovalForTools,
  ruleConnectionLabel,
  scopedRuleMayApply,
  scopedRulesCover,
  shouldSuggestAlways,
  toolRequiresApproval,
  toolRequiresExplicitApproval,
  unattendedTriggerToolRequiresApproval,
} from "@corvo/core";
import { normalizedHttpUrl, urlSite } from "@corvo/core/egress";
import {
  approvalCallHash,
  approvalEffectKey,
  toolEffectIdempotencyKey,
} from "@corvo/core/node/approval-effect-key";
import { listAnsweredApprovalCards, runSecretKind } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { FleetCardSummary } from "./approval-ask.js";
import { buildApprovalAskBlock, MAX_FETCH_URL_LENGTH } from "./approval-ask.js";
import {
  claimApprovedEffect,
  claimIntendedEffect,
  resolveDuplicateEffectGate,
  settleUncertainEffect,
  uncertainEffectResult,
} from "./approval-effect.js";
import type { AutoReviewChecker } from "./auto-review.js";
import {
  isAutoReviewCheckerConfigured,
  redactToolArgsForReview,
  resolveAutoReviewChecker,
} from "./auto-review.js";
import { reviewWithBackups } from "./auto-review-backups.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { isFleetApprovalTool } from "./fleet-tools.js";
import { isCatalogLookupCall } from "./lazy-tool-catalog.js";
import { findConnectedModelCredential } from "./model-selection.js";
import { autoReviewCheckerProvider } from "./run-auto-review.js";
import type { RunContext, RunTrust } from "./run-context.js";
import {
  isRunTainted,
  nextMutatingEffectOccurrence,
  pauseForApproval,
  pauseForSecret,
  persistTurnCheckpoint,
} from "./run-context.js";
import { completeEffect, recordEffect, uncertainEffectError } from "./run-effects.js";
import { renewRunLease } from "./run-lifecycle.js";
import { publishMessage } from "./run-messages.js";
import { overMoneyCap } from "./run-money-cap.js";
import { notifyRun } from "./run-notifications.js";
import { noteApprovalInParentChat } from "./run-parent-notice.js";
import { resolveCompletedSecretLeftover } from "./run-secret.js";
import { classifyUnknownTools } from "./run-tool-classification.js";
import type { ToolRequest } from "./run-tool-request.js";
import { BUILTIN_AGENT_TOOL_NAMES, READ_ONLY_AGENT_TOOLS } from "./run-tool-selection.js";
import { callMediaTool } from "./run-tools-files.js";
import { connectorTrustKeys } from "./run-trust.js";
import { commandWatchFromTool } from "./schedule-tools.js";
import { waitTicketRun } from "./ticket-run-moves.js";

const MAX_CLASSIFIED_PER_CONNECTION = 40;

export type AppliedEffect = Awaited<ReturnType<typeof recordEffect>>;

/** A tool call that passed its approval gate, as tool handlers receive it. */
export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly executionId: string;
  readonly observer: AgentToolExecutionObserver | undefined;
  readonly connectorCall: ConnectorCall;
  /** Idempotency key of this call's effect; also the delivery key of what it sends. */
  readonly effectKey: string;
  /** The effect recorded for this call. Read-only tools that need no approval have none. */
  readonly applied: AppliedEffect | undefined;
  /** Binds the call to its approval: tool, connection and canonical params. */
  readonly callHash: string;
  readonly nextApprovedTool: string | undefined;
  /** A gated call that policy or the reviewer allowed without asking. */
  readonly bypassApproval: boolean;
  /** This call moved its effect to executing. request_secret can hand the claim back. */
  claimedEffect: boolean;
  /** Store the result on the effect; false when it could not be stored. */
  readonly persistEffectResult: (result: unknown) => Promise<boolean>;
  /** Store the result and return it, or an uncertain-effect result when storing failed. */
  readonly finish: (result: unknown) => Promise<unknown>;
  /** Claim the effect to execute it, or return what an earlier attempt already settled. */
  readonly claimOrReturn: (from: "approved" | "intended") => Promise<unknown | undefined>;
}

export type ToolHandler = (ctx: RunContext, call: ToolCall) => Promise<unknown>;
export type ToolHandlers = Record<string, ToolHandler>;

type GateOutcome = { result: unknown } | { call: ToolCall };

type ToolReview = {
  name: string;
  args: Record<string, unknown>;
  connectorKind: ReturnType<typeof connectorKindFromToolName>;
  newSite: boolean;
  fetchUrl: string | undefined;
  matchingRules: ReturnType<typeof resolveActionApprovalForTools>["matchingRules"];
  gated: boolean;
  applied: AppliedEffect | undefined;
  injectedReview: ExecutorDeps["autoReview"];
  checker: AutoReviewChecker | null | undefined;
  reviewSettings: Awaited<ReturnType<RunTrust["loadApprovalModel"]>> | null;
  memberChecker: boolean;
};

/**
 * Decide whether a resolved call runs, asks the owner, is reviewed, or is refused, and record
 * the effect it claims. Returns the result to hand back when the call stops here.
 */
export async function gateToolCall(
  ctx: RunContext,
  request: ToolRequest,
  observer: AgentToolExecutionObserver | undefined,
): Promise<GateOutcome> {
  const { deps, run, runId, context } = ctx;
  const { name, executionId, connectorCall, resolvedTool, nextApprovedTool, approvedEffectKey } =
    request;
  const { replayEffectToolName } = request;
  let { args, effectRequest } = request;
  const viaConnector = !BUILTIN_AGENT_TOOL_NAMES.has(name);
  // Declared effect of the operation this call dispatches (installed API method and
  // flag). Install config is immutable per route resource, so it cannot drift before
  // execute; a catalog call uses the tool it was just resolved to.
  const declaredReadOnly = viaConnector
    ? (resolvedTool ?? ctx.tools.connector.get(name))?.readOnly
    : undefined;
  // A Composio batch names its actions in tools[].tool_slug, so rules and the read/write
  // check look at each action, never the batch tool. An entry naming no action asks.
  const composioBatch = composioBatchActions(name, args);
  const unidentifiedAction = Boolean(composioBatch && !composioBatch.complete);
  const approvalToolNames = composioBatch?.slugs.length ? composioBatch.slugs : [name];
  // Only the built-in partner connection's own reads skip the name check; the same name from any
  // other source (an MCP server, an installed API) still asks.
  const fromPartnerConnector = viaConnector && connectorCall.route?.connectorId === "partner";
  const declaredReadOnlyFor = (toolName: string) =>
    toolName === name ? declaredReadOnly : ctx.tools.connector.get(toolName)?.readOnly;
  const declaredDestructiveFor = (toolName: string) =>
    viaConnector
      ? (toolName === name
          ? (resolvedTool ?? ctx.tools.connector.get(name))
          : ctx.tools.connector.get(toolName)
        )?.destructive
      : undefined;
  // Looking a tool up in the catalog runs nothing at the provider, so its name need not read as a
  // read. Taint and trust still apply to it below, as they do to a catalog search.
  const catalogLookup =
    viaConnector && !composioBatch && isCatalogLookupCall(connectorCall.route, declaredReadOnly);
  const requiresUnattendedApproval =
    (unidentifiedAction && run.trigger === "webhook") ||
    (!catalogLookup &&
      approvalToolNames.some((toolName) =>
        unattendedTriggerToolRequiresApproval(
          run.trigger,
          toolName,
          viaConnector,
          declaredReadOnlyFor(toolName),
        ),
      ));
  const connectorProviders = ctx.tools.connectedPlugins.map((plugin) => plugin.provider);
  const connectorKind = connectorKindFromToolName(name, connectorProviders);
  const fetchUrl = name === "web_fetch" ? normalizedHttpUrl(String(args.url ?? "")) : undefined;
  const fetchSite = fetchUrl ? urlSite(fetchUrl) : undefined;
  if (name === "web_fetch" && !fetchSite)
    return { result: { error: "url must be an http(s) URL" } };
  if (fetchUrl && fetchUrl.length > MAX_FETCH_URL_LENGTH)
    return { result: { error: `url must be at most ${MAX_FETCH_URL_LENGTH} characters` } };
  // The card, the stored effect and the request all use the URL the gate checked.
  if (fetchUrl) {
    args = { ...args, url: fetchUrl };
    effectRequest = args;
  }
  // Reads are free, so text an injected instruction made the agent read could leave inside a URL.
  // This only refuses more: the site checks below still apply to every URL that passes.
  const leak = leakedOutboundUrl(ctx, name, args);
  if (leak) return { result: { error: leak } };
  const connectorTrusts = connectorTrustKeys(
    name,
    args,
    connectorCall.route,
    connectorKind,
    connectorProviders,
  );
  const siteGate =
    fetchUrl && fetchSite
      ? outboundSiteGate({
          site: fetchSite,
          trusted:
            ctx.trust.searchResultUrls.has(fetchUrl) ||
            (await ctx.trust.loadTrustedSites()).has(fetchSite),
          rules: await ctx.trust.loadApprovalRules(),
        })
      : "allow";
  // Outside content entered this run and it has not used this connector yet: its arguments may
  // have been chosen by that content.
  const steeredConnector = async () =>
    connectorReadRequiresApproval({
      tainted: await isRunTainted(ctx),
      connectorTrusted: await ctx.trust
        .loadTrustedConnectors()
        .then((trusted) => connectorTrusts.every((trust) => trusted.has(trust))),
    });
  const nameRisks = approvalToolNames.map((toolName) =>
    connectorToolRisk(
      toolName,
      declaredReadOnlyFor(toolName),
      fromPartnerConnector,
      declaredDestructiveFor(toolName),
    ),
  );
  // A tool no name check places may get a model's suggestion, when the owner opted in. It can only
  // move an unknown tool, never a locked, hinted or already placed one.
  const calledTool =
    viaConnector && !composioBatch && !unidentifiedAction && !catalogLookup
      ? (resolvedTool ?? ctx.tools.connector.get(name))
      : undefined;
  const suggestions =
    calledTool && nameRisks[0] === "unknown"
      ? await classifyUnknownTools(
          ctx,
          connectorTrusts[0]!,
          unknownToolsOfConnection(ctx, calledTool, connectorTrusts[0]!, connectorProviders),
        )
      : undefined;
  const toolRisks = nameRisks.map((risk, index) =>
    index === 0 && suggestions
      ? applyToolClassification(risk, suggestions.get(name), { readOnly: declaredReadOnly })
      : risk,
  );
  const overCap = viaConnector
    ? await overMoneyCap(ctx, {
        tools: approvalToolNames.map((toolName, index) => ({
          name: toolName,
          risk: toolRisks[index]!,
        })),
        args,
        batch: Boolean(composioBatch),
      })
    : false;
  const connectorReadGated =
    viaConnector &&
    !unidentifiedAction &&
    (catalogLookup || toolRisks.every((risk) => risk === "read")) &&
    (await steeredConnector());
  // This schedules unattended shell execution; require a person to approve
  // the command once, rather than letting an allow rule or reviewer schedule it.
  const commandWatch = name === "schedule_create" && commandWatchFromTool(args.watch) !== undefined;
  // A routine's prompt counts as the owner's words when it runs, so the sites it names are
  // ones its runs may fetch. Once outside content entered this run, a routine naming a
  // site this run was not given needs a person: a reviewer would judge it on this run's
  // context, and passing it would trust the site for every later run.
  const scheduleNamesNewSite =
    (name === "schedule_create" || (name === "schedule_update" && Boolean(args.prompt))) &&
    (await isRunTainted(ctx)) &&
    (await ctx.trust.routineNamesNewSite(String(args.prompt ?? "")));
  const requiresApprovalByDefault =
    commandWatch ||
    requiresUnattendedApproval ||
    siteGate === "new" ||
    unidentifiedAction ||
    (!catalogLookup &&
      approvalToolNames.some((toolName, index) =>
        toolRequiresApproval(
          toolName,
          viaConnector,
          declaredReadOnlyFor(toolName),
          fromPartnerConnector,
          declaredDestructiveFor(toolName),
          toolRisks[index],
        ),
      ));
  // A gated read still fails closed when its review errors, and keeps its approval key.
  const gated = requiresApprovalByDefault || connectorReadGated;
  const requiresMandatoryApproval =
    commandWatch ||
    scheduleNamesNewSite ||
    requiresUnattendedApproval ||
    toolRequiresExplicitApproval(name);
  const resolvedRules = resolveActionApprovalForTools({
    tools: approvalToolNames.map((toolName) => ({
      name: toolName,
      connectorKind:
        toolName === name ? connectorKind : connectorKindFromToolName(toolName, connectorProviders),
      readOnly: declaredReadOnlyFor(toolName),
    })),
    wrapper: composioBatch ? { name, connectorKind } : undefined,
    site: fetchSite,
    rules: await ctx.trust.loadApprovalRules(),
  });
  const baseResolved =
    unidentifiedAction && resolvedRules.decision === "allow"
      ? { ...resolvedRules, decision: "ask" as const }
      : resolvedRules;
  // One tool on one connection for this agent, the way an "Always allow" card offers it. Never a
  // fetch, a catalog lookup or an unnamed action, and never a locked kind (see alwaysAllowTargets).
  const alwaysTargets =
    fetchUrl || catalogLookup || unidentifiedAction
      ? null
      : alwaysAllowTargets(
          approvalToolNames.map((toolName, index) => ({
            tool: toolName,
            connection: viaConnector ? (connectorTrusts[index] ?? connectorTrusts[0]!) : "builtin",
            builtin: !viaConnector,
            destructive: declaredDestructiveFor(toolName),
          })),
        );
  const keptRules = alwaysTargets
    ? scopedRulesCover(await ctx.trust.loadScopedRules(), ctx.bot.id, alwaysTargets)
    : null;
  // A kept rule stands in for a card only where no block or ask rule decided, and never for a
  // high-risk call after outside content entered the run or in a run the owner did not start.
  const keptRuleApplies =
    keptRules !== null &&
    baseResolved.decision === "allow" &&
    baseResolved.source === "default" &&
    scopedRuleMayApply({
      risks: toolRisks,
      tainted: await isRunTainted(ctx),
      ownerStartedRun: ctx.source.ownerStartedRun,
      steeredConnector: await steeredConnector(),
    });
  const approvalResolved = keptRuleApplies
    ? { ...baseResolved, source: "always_allow" as const }
    : baseResolved;
  const mode = effectiveApprovalMode(
    ctx.bot.approvalMode,
    approvalModeFromPreference(await ctx.trust.loadAutoReviewPreference()),
  );
  // Only what's risky lets an undoable change inside a connection run. Not when someone else may
  // have steered it: outside content in the run on a connector it has not used, or a run the owner
  // did not start.
  const lowRisk =
    viaConnector &&
    !unidentifiedAction &&
    !catalogLookup &&
    ctx.source.ownerStartedRun &&
    toolRisks.every((risk) => risk === "read" || risk === "low") &&
    !(await steeredConnector());
  const reviewable = mode === "auto" && !requiresMandatoryApproval;
  const injectedReview = reviewable ? deps.autoReview : undefined;
  const reviewSettings = !reviewable || injectedReview ? null : await ctx.trust.loadApprovalModel();
  const memberChecker = reviewSettings?.primarySource === "member";
  const checker = !reviewable
    ? undefined
    : reviewSettings
      ? reviewSettings.primary
        ? {
            provider: reviewSettings.primary.provider,
            model: reviewSettings.primary.modelId,
            thinkingLevel: reviewSettings.primary.thinkingLevel,
            credentialId: reviewSettings.primary.credentialId,
          }
        : null
      : resolveAutoReviewChecker();
  const checkerConfigured =
    reviewable &&
    (Boolean(injectedReview) ||
      memberChecker ||
      Boolean(reviewSettings?.backups.length) ||
      (checker
        ? isAutoReviewCheckerConfigured({}) ||
          Boolean(
            await findConnectedModelCredential(
              deps.prisma,
              deps.secretStore,
              { userId: run.userId, spaceId: run.spaceId },
              checker.provider,
            ),
          )
        : false));
  const steerable =
    requiresMandatoryApproval && mode === "never"
      ? !ctx.source.ownerStartedRun || (await isRunTainted(ctx))
      : undefined;
  const ownerPresent = steerable
    ? ctx.source.ownerStartedRun && !(await ctx.trust.receivedOutsideMessage())
    : undefined;
  const planFor = (resolved: typeof approvalResolved) =>
    planActionGate({
      resolved,
      mode,
      mandatory: requiresMandatoryApproval,
      steerable,
      ownerPresent,
      consequential: requiresApprovalByDefault,
      lowRisk,
      reviewOnly: connectorReadGated,
      checkerConfigured,
      newDestination: siteGate === "new",
      overMoneyCap: overCap,
    });
  const plan = planFor(approvalResolved);
  if (plan === "deny") {
    return {
      result: {
        error:
          approvalResolved.decision === "deny"
            ? `${name} is blocked in this space. Don't try it another way; tell the user it's blocked.`
            : `${name} needs the owner's approval because it could have been asked for by someone else, and this space never asks. Don't retry; tell the user.`,
      },
    };
  }
  // The call ran because of a rule when nothing else would have let it run unasked.
  const ruleDecided =
    plan === "allow" &&
    approvalResolved.source === "always_allow" &&
    planFor({ ...approvalResolved, source: "default", matchingRules: [] }) !== "allow";
  const approvalRuleId = ruleDecided
    ? keptRuleApplies
      ? keptRules?.[0]?.id
      : approvalResolved.matchingRules.find((rule) => rule.effect === "always_allow" && rule.id)?.id
    : undefined;
  // What binds the approval to this exact call: tool, connection and canonical params.
  const callHash = approvalCallHash({
    tool: replayEffectToolName,
    connection: viaConnector ? connectorTrusts.join("|") : "builtin",
    args,
  });
  let reviewReason: string | undefined;
  let gateDecision: "ask" | "allow" = plan === "ask" ? "ask" : "allow";
  const needsApprovalEarly = plan === "ask" || plan === "judge";
  // A resumed approval keeps its key even if "Always allow" changed the policy.
  const usesApprovalKey =
    nextApprovedTool || name === "request_secret" || needsApprovalEarly || gated;
  // Count before choosing a key so an approved replay (occurrence 0 / base
  // key) cannot collide with a later identical-args call in this attempt.
  // request_secret stays single-use: retries must reuse the same card.
  const occurrence =
    name === "request_secret" || name === "connect_app"
      ? 0
      : nextMutatingEffectOccurrence(
          ctx,
          replayEffectToolName,
          args,
          executionId,
          approvedEffectKey,
        );
  // An approved replay claims the row the user approved. A derived key can differ
  // (another call's occurrence count), which would ask again and strand the approval.
  const effectKey =
    approvedEffectKey ??
    (usesApprovalKey && occurrence === 0
      ? approvalEffectKey(runId, replayEffectToolName, args)
      : toolEffectIdempotencyKey(runId, replayEffectToolName, args, occurrence));
  // Connector read-only hints must not bypass approval, review, or replay decisions.
  // A fetch to a new site is gated like any action, so it needs an effect to approve.
  const applied =
    READ_ONLY_AGENT_TOOLS.has(name) &&
    siteGate !== "new" &&
    nextApprovedTool !== name &&
    !approvedEffectKey
      ? undefined
      : await recordEffect(
          deps,
          run,
          replayEffectToolName,
          effectKey,
          effectRequest,
          executionId,
          ctx.state.effects.consumedIds,
          {
            callHash,
            ...(alwaysTargets ? { alwaysScope: { targets: alwaysTargets } } : {}),
            ...(approvalRuleId ? { approvalRuleId } : {}),
          },
        );
  if (applied && !applied.duplicate && approvalRuleId) {
    // Every call a rule let through shows in the conversation, with the tool it ran.
    await publishMessage(deps, run, "system", [
      {
        kind: "meta",
        text: `Auto-approved by rule: ${approvalToolNames.join(", ")}`,
        code: "rule_approved",
        params: { tool: approvalToolNames.join(", ") },
      },
    ]).catch((error) => getLogger().error("rule approval notice", error));
  }

  const runAutoReview = async () => {
    const judged = await reviewToolCall(ctx, {
      name,
      args,
      connectorKind,
      newSite: siteGate === "new",
      fetchUrl,
      matchingRules: approvalResolved.matchingRules,
      gated,
      applied,
      injectedReview,
      checker,
      reviewSettings,
      memberChecker,
    });
    if (!judged) return;
    reviewReason = judged.reason;
    gateDecision = judged.decision;
  };

  if (applied && plan === "judge" && (injectedReview || checker)) {
    if (!applied.duplicate) {
      await runAutoReview();
    } else {
      const priorDecision = applied.effect.reviewDecision;
      if (priorDecision === "ask" || priorDecision === "error") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "ask";
      } else if (priorDecision === "pass") {
        reviewReason =
          typeof applied.effect.reviewReason === "string" ? applied.effect.reviewReason : undefined;
        gateDecision = "allow";
      } else {
        await runAutoReview();
      }
    }
  } else if (applied?.duplicate && plan === "ask") {
    gateDecision = "ask";
  }
  if (context.signal.aborted) return { result: pauseForApproval(ctx) };
  if (
    siteGate === "new" &&
    newSiteOutcome({ trigger: run.trigger, decision: gateDecision }) === "deny"
  ) {
    if (applied) {
      await deps.prisma.externalEffect.updateMany({
        where: { id: applied.effect.id, status: "intended" },
        data: { status: "denied" },
      });
    }
    return {
      result: { error: `Fetching ${fetchSite} needs approval, and a webhook run cannot ask.` },
    };
  }

  const needsApproval = gateDecision === "ask";
  const call = createToolCall(ctx, {
    name,
    args,
    executionId,
    observer,
    connectorCall,
    effectKey,
    applied,
    callHash,
    nextApprovedTool,
    bypassApproval: gateDecision === "allow" && gated,
  });
  const card: CardOptions = {
    reviewReason,
    summary: request.fleetSummary,
    // The card says exactly what "Always allow" keeps, or offers none for a locked kind.
    alwaysAllow: fetchUrl
      ? undefined
      : alwaysTargets
        ? {
            agent: ctx.bot.name,
            connection: ruleConnectionLabel(alwaysTargets[0]!),
            tool: approvalToolNames.join(", "),
          }
        : (false as const),
  };
  // A person who allowed this agent's tool every time lately is told once they can stop being
  // asked. The mark stays on the card's scope so the offer is not repeated.
  if (needsApproval && applied && alwaysTargets && !fetchUrl) {
    const answered = await listAnsweredApprovalCards(deps.prisma, {
      spaceId: run.spaceId,
      botId: ctx.bot.id,
      kind: replayEffectToolName,
    }).catch(() => []);
    if (shouldSuggestAlways(ctx.bot.id, alwaysTargets, answered)) {
      card.suggestAlways = true;
      await deps.prisma.externalEffect.updateMany({
        where: { id: applied.effect.id, status: "intended" },
        data: { alwaysScope: { targets: alwaysTargets, suggested: true } },
      });
    }
  }

  if (applied?.duplicate) {
    const gate = resolveDuplicateEffectGate(applied.effect, name);
    if (gate.action === "return") {
      if (name === "request_secret") {
        const replacementSecret = await deps.prisma.secret.findFirst({
          where: {
            spaceId: run.spaceId,
            userId: run.userId,
            kind: runSecretKind(runId),
          },
          select: { id: true, createdAt: true },
        });
        if (!replacementSecret) return { result: gate.result };
        // Crash between persist and delete leaves the same OTP row. Do not
        // resubmit it to the connector; only newer rows are replacements.
        const effectUpdatedAt = applied.effect.updatedAt;
        if (
          !(effectUpdatedAt instanceof Date) ||
          resolveCompletedSecretLeftover({
            secretCreatedAt: replacementSecret.createdAt,
            effectUpdatedAt,
          }) === "drop_leftover"
        ) {
          await deps.prisma.secret.delete({
            where: { id: replacementSecret.id },
          });
          return { result: gate.result };
        }
      } else {
        return { result: gate.result };
      }
    }
    if (gate.action === "paused") {
      if (name === "request_secret") {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForSecret(ctx) };
        }
        // An intended secret request resumes protected entry below, including
        // recovery after action approval but before the card was committed.
      } else if (!needsApproval) {
        const early = await call.claimOrReturn("intended");
        if (early !== undefined) return { result: early };
      } else {
        const current = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (current?.status === "waiting_input") {
          return { result: pauseForApproval(ctx) };
        }
        return { result: await requestApproval(ctx, call, card) };
      }
    } else if (gate.action === "uncertain") {
      return { result: await settleToolUncertainty(ctx, call, applied.effect.id, gate.toolName) };
    } else if (gate.action === "execute") {
      const early = await call.claimOrReturn("approved");
      if (early !== undefined) return { result: early };
    }
  } else if (needsApproval && applied) {
    return { result: await requestApproval(ctx, call, card) };
  } else if (call.bypassApproval && applied) {
    const early = await call.claimOrReturn("intended");
    if (early !== undefined) return { result: early };
  }
  // Past the gate: this destination is now one the run was given. A search result's exact
  // URL trusts only that URL, never the rest of its site.
  if (fetchSite && siteGate === "new") (await ctx.trust.loadTrustedSites()).add(fetchSite);
  if (viaConnector) {
    const trusted = await ctx.trust.loadTrustedConnectors();
    for (const trust of connectorTrusts) trusted.add(trust);
  }
  return { call };
}

/** Why an outbound URL in this call may carry data out, or undefined when it may go. */
function leakedOutboundUrl(
  ctx: RunContext,
  name: string,
  args: Record<string, unknown>,
): string | undefined {
  const { egress } = ctx.state;
  const known = {
    has: (url: string) => egress.knownUrls.has(url) || ctx.trust.searchResultUrls.has(url),
  };
  for (const url of outboundUrlsOfCall(name, args)) {
    const refused = outboundUrlLeak({
      url,
      privateText: egress.privateText,
      knownUrls: known,
      secrets: ctx.secrets,
    });
    if (refused) return refused.error;
  }
  return undefined;
}

/**
 * The connection's tools no name check places, with the called one first, for one batch. The same
 * set (up to a bound) answers every tool of the connection, so the cache fills in one call.
 */
function unknownToolsOfConnection(
  ctx: RunContext,
  called: ConnectorTool,
  connection: string,
  providers: string[],
): ConnectorTool[] {
  const siblings = [...ctx.tools.connector.values()]
    .filter(
      (tool) =>
        tool.name !== called.name &&
        connectorTrustKeys(
          tool.name,
          {},
          tool.route,
          connectorKindFromToolName(tool.name, providers),
          providers,
        )[0] === connection &&
        connectorToolRisk(
          tool.name,
          tool.readOnly,
          tool.route?.connectorId === "partner",
          tool.destructive,
        ) === "unknown",
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .slice(0, MAX_CLASSIFIED_PER_CONNECTION - 1);
  return [called, ...siblings];
}

/**
 * Whether the backend may call a connector's status tool for the agent: only where the agent's
 * own call to it would run without asking, under the same rules, trigger and taint checks.
 */
export async function statusCallAllowed(ctx: RunContext, tool: ConnectorTool): Promise<boolean> {
  const providers = ctx.tools.connectedPlugins.map((plugin) => plugin.provider);
  const connectorKind = connectorKindFromToolName(tool.name, providers);
  const resolved = resolveActionApprovalForTools({
    tools: [{ name: tool.name, connectorKind, readOnly: true }],
    rules: await ctx.trust.loadApprovalRules(),
  });
  if (resolved.decision !== "allow") return false;
  if (
    resolved.source !== "always_allow" &&
    connectorToolRequiresApproval(tool.name, true, false, tool.destructive)
  )
    return false;
  if (unattendedTriggerToolRequiresApproval(ctx.run.trigger, tool.name, true, true)) return false;
  const trusts = connectorTrustKeys(tool.name, {}, tool.route, connectorKind, providers);
  const trusted = await ctx.trust.loadTrustedConnectors();
  return !connectorReadRequiresApproval({
    tainted: await isRunTainted(ctx),
    connectorTrusted: trusts.every((trust) => trusted.has(trust)),
  });
}

function createToolCall(
  ctx: RunContext,
  fields: Omit<ToolCall, "claimedEffect" | "persistEffectResult" | "finish" | "claimOrReturn">,
): ToolCall {
  const { deps } = ctx;
  const { name, args, applied } = fields;
  const call: ToolCall = {
    ...fields,
    claimedEffect: false,
    persistEffectResult: (result) =>
      applied
        ? completeEffect(
            deps,
            applied.effect.id,
            call.claimedEffect ? "executing" : "intended",
            result,
          )
        : Promise.resolve(true),
    finish: async (result) =>
      (await call.persistEffectResult(result)) ? result : uncertainEffectResult(name, args),
    claimOrReturn: async (from) => {
      // The call that runs must be the call the card showed: a different tool, connection or
      // param than the one approved is refused, and the approval is spent.
      const approvedHash = applied!.effect.callHash;
      if (from === "approved" && approvedHash && approvedHash !== fields.callHash) {
        await deps.prisma.externalEffect.updateMany({
          where: { id: applied!.effect.id, status: "approved" },
          data: { status: "denied" },
        });
        return {
          error: `${name} no longer matches what was approved, so it did not run. Ask again if it is still needed.`,
        };
      }
      const claim = from === "approved" ? claimApprovedEffect : claimIntendedEffect;
      if (await claim(deps.prisma, applied!.effect.id)) {
        call.claimedEffect = true;
        return undefined;
      }
      const current = await deps.prisma.externalEffect.findUnique({
        where: { id: applied!.effect.id },
      });
      if (current) {
        const retryGate = resolveDuplicateEffectGate(current, name);
        if (retryGate.action === "return") return retryGate.result;
        if (retryGate.action === "uncertain") {
          return settleToolUncertainty(ctx, call, applied!.effect.id, name);
        }
      }
      throw uncertainEffectError(name);
    },
  };
  return call;
}

async function settleToolUncertainty(
  ctx: RunContext,
  call: ToolCall,
  effectId: string,
  toolName: string,
) {
  if (call.name === "generate_image" || call.name === "generate_video") {
    const recovered = await callMediaTool(ctx, call, true);
    if (
      recovered !== undefined &&
      (await completeEffect(ctx.deps, effectId, "executing", recovered))
    )
      return recovered;
  }
  return settleUncertainEffect(ctx.deps.prisma, effectId, toolName, call.args);
}

/** Most proposal cards one reply puts on a message; the database enforces it. */
export { FLEET_CARD_BATCH_MAX } from "@corvo/db";

type CardOptions = {
  reviewReason: string | undefined;
  summary: FleetCardSummary | undefined;
  alwaysAllow: { agent: string; connection: string; tool: string } | false | undefined;
  suggestAlways?: boolean;
};

/**
 * Ask the owner through an approval card. Parallel calls share the first call's pause. Fleet
 * proposals from one reply are added to that first card's message, so the owner decides them one
 * by one and the run resumes once every card is decided.
 */
function requestApproval(ctx: RunContext, call: ToolCall, card: CardOptions) {
  const { approval } = ctx.state;
  // Parallel calls can need approval at once. Only the first saves the turn and shows
  // its card; the others wait for that pause. Otherwise a later call's save could make
  // the turn resume a call other than the one the user approved.
  if (approval.request) {
    const joins = approval.requestIsProposal && isFleetApprovalTool(call.name) && card.summary;
    return approval.request.then(async () => {
      // When the first card was already answered the card cannot join, and this call keeps
      // today's behaviour: it pauses again with its own card after the run resumes.
      if (joins && call.applied) {
        await ctx.deps.events.addApprovalAskToPausedRun({
          spaceId: ctx.run.spaceId,
          threadId: ctx.run.threadId,
          runId: ctx.runId,
          block: buildApprovalAskBlock(
            call.applied.effect.id,
            call.name,
            call.args,
            ctx.secrets,
            card,
          ),
        });
      }
      return pauseForApproval(ctx);
    });
  }
  approval.requestIsProposal = isFleetApprovalTool(call.name) && Boolean(card.summary);
  approval.request = showApprovalCard(ctx, call, card);
  return approval.request;
}

async function showApprovalCard(ctx: RunContext, call: ToolCall, card: CardOptions) {
  const { deps, run, runId, bot, thread } = ctx;
  const { name, args, executionId, applied } = call;
  if (!(await renewRunLease(deps, runId, ctx.workerId, ctx.fence))) {
    // Another worker owns the run now; exit without leaving a local pause card.
    return pauseForApproval(ctx);
  }
  await ctx.computer.checkpoint.flush();
  await persistTurnCheckpoint(ctx, executionId);
  await ctx.settleRunningHelpers();
  const paused = await deps.events.pauseRunForInput({
    spaceId: run.spaceId,
    threadId: run.threadId,
    botId: run.botId,
    runId,
    attemptId: ctx.attempt.id,
    leaseOwner: ctx.workerId,
    leaseFence: ctx.fence,
    blocks: [
      buildApprovalAskBlock(
        applied!.effect.id,
        name,
        name === "propose_instructions_update" ? { ...args, botId: bot.id } : args,
        ctx.secrets,
        card,
      ),
    ],
  });
  // pauseRunForInput returning false after a successful renew means the run row no
  // longer matches this worker. Exiting via pauseForApproval() would leave the run
  // stuck in "running" with no ask card — fail instead so the user can retry.
  if (!paused) {
    throw new Error("Could not pause this run for approval; try sending again.");
  }
  await waitTicketRun(deps, run);
  if (paused.continuationRunId) {
    await deps.jobs
      .enqueue(runContinueJob(paused.continuationRunId))
      .catch((error) => getLogger().error("steering continuation enqueue", error));
  }
  await notifyRun(
    deps,
    run,
    {
      kind: "help",
      title: `${displayName(bot.name, "Bot")} needs approval`,
      body: `Review before ${name}`,
      botId: bot.id,
      threadId: thread.id,
    },
    { inbox: "approval" },
  );
  await noteApprovalInParentChat(deps, { bot, effectId: applied!.effect.id });
  return pauseForApproval(ctx);
}

/**
 * Run the configured reviewer (and its backups) on a call and store its verdict on the
 * effect. Returns nothing when there is no reviewer or the run was cancelled.
 */
async function reviewToolCall(
  ctx: RunContext,
  review: ToolReview,
): Promise<{ reason: string | undefined; decision: "ask" | "allow" } | undefined> {
  const { deps, run, runId, bot, thread, context } = ctx;
  const { name, args, connectorKind, fetchUrl, gated, applied } = review;
  const { injectedReview, checker, reviewSettings, memberChecker } = review;
  if (!injectedReview && !checker && !reviewSettings?.backups.length) return;
  try {
    const botDescription = redactSecrets(
      `${bot.name}: ${bot.title}\n${bot.description}`,
      ctx.secrets,
    );
    // A new site is judged on the full URL and the owner's own words only: the task
    // prompt of a webhook or bot-started run carries text someone else wrote.
    const reviewRequest: AutoReviewRequest =
      review.newSite && fetchUrl
        ? {
            toolName: name,
            connectorKind,
            args: { url: redactSecrets(fetchUrl, ctx.secrets) },
            userTask: redactSecrets(await ctx.trust.loadOwnerWords(), ctx.secrets),
            botDescription,
            matchingRules: review.matchingRules,
            newSite: true,
          }
        : {
            toolName: name,
            connectorKind,
            args: redactToolArgsForReview(args, ctx.secrets),
            userTask: redactSecrets(ctx.task.prompt, ctx.secrets),
            botDescription,
            matchingRules: review.matchingRules,
          };
    const reviewContext: AdapterContext = {
      operationId: `auto-review:${runId}`,
      traceId: `auto-review:${runId}`,
      spaceId: run.spaceId,
      userId: run.userId,
      botId: bot.id,
      runId,
      signal: context.signal,
    };
    const checkerProvider = (checker: AutoReviewChecker) =>
      autoReviewCheckerProvider(
        deps,
        {
          runId,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          threadId: thread.id,
        },
        {
          injectedReview,
          memberChecker,
          backups: reviewSettings?.backups,
          registerSecrets: (values) => ctx.secrets.push(...values),
        },
        checker,
      );
    const judge = await reviewWithBackups(
      [
        ...(checker
          ? [checker]
          : injectedReview
            ? [{ provider: "injected", model: "injected" }]
            : []),
        ...(reviewSettings?.backups.map((choice) => ({
          provider: choice.provider,
          model: choice.modelId,
          thinkingLevel: choice.thinkingLevel,
          credentialId: choice.credentialId,
        })) ?? []),
      ],
      async (checker) => {
        const provider = await checkerProvider(checker);
        return provider.review(reviewRequest, reviewContext);
      },
      context.signal,
    );
    if (context.signal.aborted) return;
    const verdict = {
      reason: judge.reason,
      decision: applyJudgeDecision({ decision: judge.decision, consequential: gated }),
    };
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: {
          reviewDecision: judge.decision,
          reviewReason: judge.reason,
          reviewModel: judge.model,
        },
      });
    }
    return verdict;
  } catch {
    // Cancellation must not write a review the next attempt would reuse.
    if (context.signal.aborted) return;
    // Auth/refresh failures must fail closed like a checker error, not fail the run.
    const reviewReason = "Checker could not authenticate.";
    const verdict = {
      reason: reviewReason,
      decision: applyJudgeDecision({ decision: "error", consequential: gated }),
    };
    if (applied) {
      await deps.prisma.externalEffect.update({
        where: { id: applied.effect.id },
        data: {
          reviewDecision: "error",
          reviewReason,
          reviewModel: checker
            ? `${checker.provider}/${checker.model}`
            : (injectedReview?.describe().id ?? "auto-review"),
        },
      });
    }
    return verdict;
  }
}
