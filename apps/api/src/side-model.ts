import { randomUUID } from "node:crypto";
import type {
  AgentRunModel,
  AgentRuntime,
  ModelCredentialFailedState,
  ModelCredentialRetireReason,
  SecretStore,
} from "@corvo/adapter-kit";
import {
  deploymentModelRole,
  hasHostedModelCredits,
  hostedModelCreditObserver,
  matchesFailedOAuthSecret,
  resolveMemberMainModel,
  resolveModelAuth,
  secretValuesToRedact,
  serializeModelSecret,
  toOAuthCredential,
} from "@corvo/adapters";
import { redactSecrets } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { findModelCredential, recordUsage, retireModelCredential } from "@corvo/db";

/**
 * One cheap, tool-less model call made for the product itself (an engagement judge, the channel
 * router) on the member's own connection, never for a bot's turn.
 */
export interface SideModelDeps {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  secrets: SecretStore;
  deploymentProvider: string;
  deploymentModel: string;
  deploymentModelKey?: string;
  providerOverride?: string;
  modelOverride?: string;
  /** The instance flag (`MCP_ALLOW_PRIVATE_ENDPOINT`). */
  allowPrivateEndpoint?: boolean;
  timeoutMs?: number;
}

/** The bot whose owner, space and model preference the call runs under. */
export interface SideModelBot {
  id: string;
  spaceId: string;
  userId: string;
  modelProvider: string | null;
  modelId: string | null;
}

async function resolveSideModel(
  deps: SideModelDeps,
  bot: SideModelBot,
): Promise<{ model: AgentRunModel } | null> {
  const settings = await deps.prisma.deploymentSettings.findUnique({
    where: { id: "default" },
  });
  const scope = { userId: bot.userId, spaceId: bot.spaceId };
  const member = await resolveMemberMainModel(
    { prisma: deps.prisma, secretStore: deps.secrets },
    scope,
  );
  const requestedProvider = deps.providerOverride ?? bot.modelProvider;
  const requestedModel = deps.modelOverride ?? bot.modelId;
  const overrideCredential = requestedProvider
    ? await findModelCredential(deps.prisma, scope, requestedProvider)
    : null;
  const explicitJudgeOverride = Boolean(deps.providerOverride && deps.modelOverride);
  const useOverride = Boolean(
    requestedProvider && requestedModel && (explicitJudgeOverride || overrideCredential),
  );
  // The member's main model runs on its connection, or on funded deployment credits.
  const main =
    member &&
    (member.credential ||
      (settings?.modelCreditsEnabled &&
        (await hasHostedModelCredits(deps.prisma, scope, member.provider))))
      ? member
      : null;
  const fallback = deploymentModelRole("main", {
    settings,
    deployment: { provider: deps.deploymentProvider, model: deps.deploymentModel },
  }).primary;
  const credential = useOverride ? overrideCredential : (main?.credential ?? null);
  const provider = useOverride ? requestedProvider : (main ?? fallback)?.provider;
  const modelId = useOverride ? requestedModel : (main ?? fallback)?.modelId;
  if (!provider || !modelId) return null;

  const hosted =
    settings?.modelCreditsEnabled && (await hasHostedModelCredits(deps.prisma, scope, provider));
  if (!credential || hosted) {
    const apiKey = provider === deps.deploymentProvider ? deps.deploymentModelKey : undefined;
    const callObserver = settings?.modelCreditsEnabled
      ? await hostedModelCreditObserver(deps.prisma, scope)
      : undefined;
    return { model: { provider, id: modelId, ...(apiKey ? { apiKey } : {}), callObserver } };
  }

  const secret = await deps.prisma.secret.findFirst({
    where: { id: credential.secretId, userId: bot.userId, spaceId: null },
  });
  if (!secret) return null;
  const persist = async (plaintext: string) => {
    const stored = await deps.secrets.put(
      plaintext,
      {
        operationId: "team-chat-judge-credential",
        traceId: "team-chat-judge-credential",
        spaceId: bot.spaceId,
        userId: bot.userId,
        botId: bot.id,
        signal: new AbortController().signal,
      },
      { recordId: secret.id },
    );
    await deps.prisma.secret.update({
      where: { id: secret.id },
      data: { ciphertext: stored.ciphertext },
    });
  };
  // Same fences as the run path: a stale failure must not delete material a
  // concurrent refresh or reconnect already persisted.
  const retire = (
    _reason: ModelCredentialRetireReason,
    _detail: string | undefined,
    failed?: ModelCredentialFailedState,
  ) =>
    retireModelCredential(deps.prisma, {
      userId: bot.userId,
      credentialId: credential.id,
      secretId: credential.secretId,
      matchesFailedSecret: failed
        ? matchesFailedOAuthSecret(
            (ciphertext, secretId) => deps.secrets.load(ciphertext, secretId),
            failed,
          )
        : undefined,
    });
  const plaintext = await deps.secrets.load(secret.ciphertext, secret.id);
  const auth = await resolveModelAuth(plaintext, provider, { persist, retire });
  const parsed = auth.secret;
  const limit = parsed.maxTokens !== undefined ? { maxTokens: parsed.maxTokens } : {};
  const context =
    parsed.kind === "oauth"
      ? {}
      : {
          cacheCapabilities: parsed.cacheCapabilities,
          contextWindow: parsed.contextWindow,
        };
  if (parsed.kind === "oauth") {
    return {
      model: {
        provider,
        id: modelId,
        ...limit,
        oauth: {
          credential: { ...parsed.credential },
          persist: async (credential) => {
            await persist(
              serializeModelSecret({
                kind: "oauth",
                credential: toOAuthCredential(credential),
                ...limit,
              }),
            );
          },
          retire,
        },
      },
    };
  }
  if (parsed.kind === "openai_compatible") {
    return {
      model: {
        provider,
        id: modelId,
        apiKey: parsed.apiKey,
        baseUrl: parsed.baseUrl,
        headers: parsed.headers,
        allowPrivateEndpoint: deps.allowPrivateEndpoint === true,

        ...limit,
        ...context,
      },
    };
  }
  return {
    model: {
      provider,
      id: modelId,
      apiKey: auth.apiKey,
      ...limit,
      ...context,
    },
  };
}

/**
 * Runs the prompt and returns the model's text, or undefined when no model is configured.
 * A failure throws with the connection's secrets redacted from its message.
 */
export async function runSideModel(
  deps: SideModelDeps,
  bot: SideModelBot,
  call: { operation: string; prompt: string; instructions: string; timeoutMs: number },
): Promise<string | undefined> {
  let secretsToRedact: string[] = [];
  try {
    const resolved = await resolveSideModel(deps, bot);
    if (!resolved) return undefined;
    secretsToRedact = secretValuesToRedact({
      kind: "openai_compatible",
      baseUrl: resolved.model.baseUrl ?? "",
      apiKey: resolved.model.apiKey,
      headers: resolved.model.headers,
    });
    const operationId = `${call.operation}:${randomUUID()}`;
    const usage = {
      spaceId: bot.spaceId,
      botId: bot.id,
      userId: bot.userId,
      operationId,
      operationKind: "setup",
    } as const;
    let text = "";
    for await (const event of deps.runtime.run(
      {
        botId: bot.id,
        threadId: operationId,
        runId: operationId,
        usageOperationKind: "setup",
        onUsage: async (event) => {
          await recordUsage(deps.prisma, event, usage);
        },
        prompt: call.prompt,
        instructions: call.instructions,
        history: [],
        tools: [],
        model: resolved.model,
      },
      {
        operationId,
        traceId: operationId,
        spaceId: bot.spaceId,
        userId: bot.userId,
        botId: bot.id,
        signal: AbortSignal.timeout(call.timeoutMs),
      },
    )) {
      if (event.type === "done" && event.text) text = event.text;
      if (event.type === "usage" && !event.accounted) {
        await recordUsage(deps.prisma, event, usage);
      }
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecrets(message, secretsToRedact));
  }
}
