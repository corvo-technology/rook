import { randomUUID } from "node:crypto";
import type { ModelTier, RunTrigger } from "@corvo/contracts";
import { MODEL_TIERS } from "@corvo/contracts";
import { modelAllowed, partnerAllowedModels, recordUsage } from "@corvo/db";
import type { ExecutorDeps } from "./executor-deps.js";
import { type DeploymentModelDefaults, effectiveModelRole } from "./model-roles.js";
import {
  decideTier,
  nextTier,
  parseTierAnswer,
  TIER_CLASSIFIER_INSTRUCTIONS,
  TIER_CLASSIFIER_MAX_TOKENS,
  TIER_CLASSIFIER_TIMEOUT_MS,
  TIER_THINKING_LEVEL,
  type TurnSignals,
  tierClassifierPrompt,
} from "./model-routing.js";
import type { ModelChoice } from "./model-selection.js";
import { catalogModelCost } from "./pi-runtime-models.js";
import { deploymentModelDefaults, resolveFastRunModel } from "./run-model.js";

export interface RoutedModel {
  tier: ModelTier;
  /** What the run uses in place of an agent's pinned model; empty on the main tier. */
  choice: (ModelChoice & { credentialId?: string }) | null;
  /** The tier's model is the deployment's, so the deployment's key serves it. */
  fromDeployment: boolean;
}

/**
 * A Rook-provided tier model the customer's partner allows: the model itself, or, when the
 * partner's list excludes it, the cheapest model on that list (the first when none has a price).
 */
async function allowedHostedModel<T extends { provider: string; modelId: string }>(
  deps: Pick<ExecutorDeps, "prisma">,
  spaceId: string,
  primary: T,
): Promise<T> {
  const allowed = await partnerAllowedModels(deps.prisma, spaceId);
  if (!allowed?.length || modelAllowed(allowed, primary.provider, primary.modelId)) return primary;
  const prefix = `${primary.provider}/`;
  const ids = allowed.map((name) => (name.startsWith(prefix) ? name.slice(prefix.length) : name));
  const price = (id: string) => {
    const cost = catalogModelCost(primary.provider, id);
    return cost ? cost.input + cost.output : Number.POSITIVE_INFINITY;
  };
  const cheapest = ids.reduce(
    (best, id) => (price(id) < price(best) ? id : best),
    ids[0] as string,
  );
  return { ...primary, modelId: cheapest };
}

/**
 * The model of a tier: the member's or space's choice for its role, else the deployment's. A tier
 * with no model of its own is served by the main one, which is what an agent without tiers runs.
 */
export async function resolveTierModel(
  deps: ExecutorDeps,
  scope: { userId: string; spaceId: string },
  tier: ModelTier,
  defaults: DeploymentModelDefaults,
): Promise<RoutedModel> {
  if (tier === "main") return { tier, choice: null, fromDeployment: false };
  const role = await effectiveModelRole(deps.prisma, scope, tier, defaults);
  if (!role.primary) return { tier: "main", choice: null, fromDeployment: false };
  const primary =
    role.primarySource === "deployment"
      ? await allowedHostedModel(deps, scope.spaceId, role.primary)
      : role.primary;
  return {
    tier,
    choice: {
      modelProvider: primary.provider,
      modelId: primary.modelId,
      thinkingLevel: role.primary.thinkingLevel ?? TIER_THINKING_LEVEL[tier],
      ...(role.primary.credentialId ? { credentialId: role.primary.credentialId } : {}),
    },
    fromDeployment: role.primarySource === "deployment",
  };
}

/**
 * The tier an automatic run may ask for: the next one up when it has a model of its own, and the
 * run has not moved up already. A tier that would fall back to the main model is no stronger.
 */
export async function strongerTierFor(
  deps: ExecutorDeps,
  run: { spaceId: string; userId: string; tierEscalations: number },
  tier: ModelTier | undefined,
  defaults: DeploymentModelDefaults,
): Promise<ModelTier | null> {
  if (!tier || run.tierEscalations > 0) return null;
  const next = nextTier(tier);
  if (!next) return null;
  return (await resolveTierModel(deps, run, next, defaults)).tier === next ? next : null;
}

/** Whether a member or the deployment set a model for a tier other than the main one. */
export async function tiersAvailable(
  deps: Pick<ExecutorDeps, "prisma">,
  scope: { userId: string; spaceId: string },
  defaults: DeploymentModelDefaults,
): Promise<boolean> {
  for (const tier of MODEL_TIERS) {
    if (tier === "main") continue;
    const role = await effectiveModelRole(deps.prisma, scope, tier, defaults);
    if (role.primary) return true;
  }
  return false;
}

/**
 * One tiny, tool-less call on the fast model that names the tier a request needs, by its meaning
 * and the agent's role. It reads at most a short excerpt and answers one word, so it costs a
 * fraction of the turn it routes. Any failure or unclear answer is "no answer" and the turn runs on
 * the main tier.
 */
export async function classifyTier(
  deps: ExecutorDeps,
  run: { id: string; spaceId: string; userId: string; botId: string },
  role: { title: string; description: string },
  request: string,
): Promise<ModelTier | null> {
  try {
    const fast = await resolveFastRunModel(deps, run);
    if (!fast) return null;
    const operationId = `tier-classifier:${randomUUID()}`;
    const attribution = {
      spaceId: run.spaceId,
      botId: run.botId,
      userId: run.userId,
      runId: run.id,
      operationId,
      operationKind: "setup",
      modelTier: "fast",
    } as const;
    let text = "";
    for await (const event of deps.runtime.run(
      {
        botId: run.botId,
        threadId: operationId,
        runId: operationId,
        usageOperationKind: "setup",
        onUsage: async (usage) => {
          await recordUsage(deps.prisma, usage, attribution);
        },
        prompt: tierClassifierPrompt(role, request),
        instructions: TIER_CLASSIFIER_INSTRUCTIONS,
        history: [],
        tools: [],
        model: { ...fast, maxTokens: TIER_CLASSIFIER_MAX_TOKENS },
      },
      {
        operationId,
        traceId: operationId,
        spaceId: run.spaceId,
        userId: run.userId,
        botId: run.botId,
        signal: AbortSignal.timeout(TIER_CLASSIFIER_TIMEOUT_MS),
      },
    )) {
      if (event.type === "done" && event.text) text = event.text;
      if (event.type === "usage" && !event.accounted) {
        await recordUsage(deps.prisma, event, attribution);
      }
    }
    return parseTierAnswer(text);
  } catch {
    return null;
  }
}

/** A request this short ("ok", "thanks", "and tomorrow?") is not worth a model call to place. */
const SHORT_TURN_CHARS = 30;

/** The tier a turn runs on, and the model that serves it. */
export async function routeRunTier(
  deps: ExecutorDeps,
  run: { id: string; spaceId: string; userId: string; botId: string },
  signals: TurnSignals,
  defaults: DeploymentModelDefaults,
  /** The tier the thread's last turn settled on, read only when a turn would need the classifier. */
  stickyTier?: () => Promise<ModelTier | null>,
): Promise<RoutedModel> {
  const decision = decideTier(signals);
  let tier = decision.tier;
  // Only a turn the structure leaves open pays for the classifier, and only once: the tier is
  // saved with the run, so a retried attempt reads it back. A short turn stays on the main tier,
  // and a conversation keeps the tier it settled on, so the classifier stands in front of a reply
  // at most once per thread.
  if (!decision.clear && !signals.floor && signals.prompt.trim().length >= SHORT_TURN_CHARS) {
    const previous = await stickyTier?.();
    tier = previous ?? (await classifyTier(deps, run, signals, signals.prompt)) ?? tier;
  }
  return resolveTierModel(deps, run, tier, defaults);
}

const CHARS_PER_TOKEN = 4;

/** The tier an automatic agent's run starts on, from what is known before any model has read it. */
export async function routeTurn(input: {
  deps: ExecutorDeps;
  run: {
    id: string;
    spaceId: string;
    userId: string;
    botId: string;
    threadId: string;
    trigger: string;
    checkpoint: string | null;
    modelTier: string | null;
    tierEscalations: number;
  };
  bot: { title: string; description: string };
  task: { prompt: string };
  messages: ReadonlyArray<{ blocks: unknown }>;
  defaults: DeploymentModelDefaults;
}): Promise<RoutedModel> {
  const { deps, run, defaults } = input;
  // A retried attempt keeps the tier its run settled on, and an escalated one starts on the tier
  // it moved to, so the decision is made once.
  const saved = MODEL_TIERS.find((tier) => tier === run.modelTier);
  if (saved) return resolveTierModel(deps, run, saved, defaults);
  const last = input.messages.at(-1)?.blocks;
  const attachments = Array.isArray(last)
    ? last.filter((block) => block?.kind === "image" || block?.kind === "file").length
    : 0;
  const contextChars = input.messages.reduce(
    (sum, message) => sum + JSON.stringify(message.blocks ?? "").length,
    0,
  );
  return routeRunTier(
    deps,
    run,
    {
      title: input.bot.title,
      description: input.bot.description,
      trigger: run.trigger as RunTrigger,
      prompt: input.task.prompt,
      contextTokens: Math.ceil(contextChars / CHARS_PER_TOKEN),
      attachments,
      approvalGated: run.trigger === "resume" || Boolean(run.checkpoint),
    },
    defaults,
    async () => {
      const previous = await deps.prisma.run.findFirst({
        where: {
          threadId: run.threadId,
          id: { not: run.id },
          trigger: "user",
          modelTier: { not: null },
        },
        orderBy: { createdAt: "desc" },
        select: { modelTier: true },
      });
      return MODEL_TIERS.find((tier) => tier === previous?.modelTier) ?? null;
    },
  );
}
