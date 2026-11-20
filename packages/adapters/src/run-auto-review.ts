import type { AgentRuntimeEvent, AutoReviewProvider } from "@corvo/adapter-kit";
import { recordUsage } from "@corvo/db";
import type { AutoReviewChecker, LlmAutoReviewOptions } from "./auto-review.js";
import { autoReviewTimeoutMs, resolveAutoReviewProviderKind } from "./auto-review.js";
import { createAutoReviewProvider } from "./auto-review-factory.js";
import { DecisionAutoReviewProvider } from "./decision-auto-review.js";
import { decisionModel } from "./decision-models.js";
import type { ExecutorDeps } from "./executor-deps.js";
import { HttpDecisionProvider } from "./http-decisions.js";
import { findConnectedModelCredential, hasHostedModelCredits } from "./model-selection.js";
import { resolveModelKey } from "./run-model.js";

type CheckerScope = {
  runId: string;
  spaceId: string;
  userId: string;
  botId: string;
  threadId: string;
};

/**
 * The connection one checker choice resolves to, and how the usage of its calls is recorded. Throws
 * when a connection the owner chose is no longer available.
 */
export async function resolveCheckerAccess(
  deps: ExecutorDeps,
  scope: CheckerScope,
  options: {
    memberChecker: boolean;
    backups?: readonly { provider: string; modelId: string }[];
    registerSecrets: (values: string[]) => void;
    /** Names this call's usage apart from the run's answers, such as `auto-review`. */
    operation: string;
  },
  checker: AutoReviewChecker,
) {
  const { runId, spaceId, userId, botId } = scope;
  const { memberChecker, backups, registerSecrets } = options;
  const reviewCredential = await findConnectedModelCredential(
    deps.prisma,
    deps.secretStore,
    { userId, spaceId },
    checker.provider,
    checker.model,
    { credentialId: checker.credentialId },
  );
  if (
    (memberChecker ||
      checker.credentialId ||
      backups?.some(
        (choice) => choice.provider === checker.provider && choice.modelId === checker.model,
      )) &&
    !reviewCredential &&
    !(await hasHostedModelCredits(deps.prisma, { userId, spaceId }, checker.provider))
  ) {
    throw new Error("Selected checker connection is unavailable");
  }
  const judgeKey = await resolveModelKey(
    deps,
    userId,
    spaceId,
    reviewCredential,
    checker.provider,
    checker.model,
    registerSecrets,
  );
  const onUsage = (event: Extract<AgentRuntimeEvent, { type: "usage" }>) =>
    recordUsage(deps.prisma, event, {
      spaceId,
      userId,
      botId,
      parentRunId: runId,
      runId,
      operationId: `${options.operation}:${runId}`,
      operationKind: "setup",
    });
  return { judgeKey, onUsage };
}

/** The options a model-run checker call takes from its resolved connection. */
export function checkerLlmOptions(
  deps: ExecutorDeps,
  scope: CheckerScope,
  access: Awaited<ReturnType<typeof resolveCheckerAccess>>,
  checker: AutoReviewChecker,
): LlmAutoReviewOptions {
  const { runId, spaceId, userId, botId, threadId } = scope;
  const { judgeKey, onUsage } = access;
  return {
    onUsage,
    runtime: deps.runtime,
    checker,
    apiKey: judgeKey.oauth ? undefined : judgeKey.apiKey,
    callObserver: judgeKey.callObserver,
    accountId: judgeKey.accountId,
    gatewayId: judgeKey.gatewayId,
    baseUrl: judgeKey.baseUrl,
    headers: judgeKey.headers,
    allowPrivateEndpoint: judgeKey.allowPrivateEndpoint,
    cacheCapabilities: judgeKey.cacheCapabilities,
    contextWindow: judgeKey.contextWindow,
    maxTokens: judgeKey.maxTokens,
    reasoning: judgeKey.reasoning,
    oauth: judgeKey.oauth
      ? {
          credential: judgeKey.oauth,
          persist: judgeKey.persistOAuth,
          retire: judgeKey.retireOAuth,
        }
      : undefined,
    runId,
    spaceId,
    userId,
    botId,
    threadId,
    timeoutMs: autoReviewTimeoutMs(),
  };
}

/** The Auto Review provider that judges a run's action with one checker choice. */
export async function autoReviewCheckerProvider(
  deps: ExecutorDeps,
  scope: CheckerScope,
  options: {
    injectedReview?: AutoReviewProvider;
    memberChecker: boolean;
    backups?: readonly { provider: string; modelId: string }[];
    registerSecrets: (values: string[]) => void;
  },
  checker: AutoReviewChecker,
): Promise<AutoReviewProvider> {
  const { injectedReview, memberChecker } = options;
  if (injectedReview) return injectedReview;
  const kind =
    memberChecker || (checker.provider !== "jev" && checker.provider !== "scripted")
      ? "llm"
      : resolveAutoReviewProviderKind();
  if (kind === "jev" || kind === "scripted") {
    return createAutoReviewProvider(kind);
  }
  const access = await resolveCheckerAccess(
    deps,
    scope,
    { ...options, operation: "auto-review" },
    checker,
  );
  return decisionModel(checker.provider, checker.model)
    ? new DecisionAutoReviewProvider({
        provider: new HttpDecisionProvider("openrouter", {
          apiKey: access.judgeKey.apiKey ?? "",
          callObserver: access.judgeKey.callObserver,
          onUsage: access.onUsage,
        }),
        providerId: checker.provider,
        model: checker.model,
      })
    : createAutoReviewProvider("llm", { llm: checkerLlmOptions(deps, scope, access, checker) });
}
