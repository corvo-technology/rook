import type { AgentRunModel } from "@corvo/adapter-kit";
import type { LocalModelTest } from "@corvo/contracts";
import { normalizeRunError } from "@corvo/core";
import type { Context } from "@earendil-works/pi-ai";
import { Type } from "@earendil-works/pi-ai";
import { withChatCompletionsCompatibility } from "./chat-completions-compat.js";
import { withCloudflareAuth } from "./cloudflare-ai-gateway.js";
import { resolveRuntimeModel } from "./pi-runtime-models.js";
import { reliableModelStream } from "./pi-runtime-stream.js";

/** Long enough for a cold provider to answer headers, short enough to keep Connect snappy. */
export const MODEL_CONNECT_CHECK_TIMEOUT_MS = 15_000;

/**
 * The check stops at the first accepted response, but providers reserve credit against the
 * requested output ceiling, so keep it small: a key funded for real runs must pass.
 */
const MODEL_CONNECT_CHECK_MAX_TOKENS = 1024;

/** One turn shaped like an agent's: a system prompt, a user message, and a tool. */
const CHECK_CONTEXT: Context = {
  systemPrompt: "Reply with OK.",
  messages: [{ role: "user", content: "OK?", timestamp: 0 }],
  tools: [{ name: "noop", description: "Does nothing.", parameters: Type.Object({}) }],
};

/**
 * Failures that every run on this key and model would hit too. Rate limits, outages, and
 * timeouts are left to the run, so a slow or busy provider never blocks a connection.
 */
const BLOCKING_KINDS = new Set(["auth", "access", "model", "key", "credit", "spending"]);

/**
 * Send one minimal agent request and stop as soon as the provider accepts it, so a key without
 * credit, an app-only free tier, a retired model, or one without tool support is refused at
 * connect with the reason runs would show. Anything inconclusive passes.
 */
export async function verifyModelServesAgents(
  config: Pick<
    AgentRunModel,
    "provider" | "id" | "apiKey" | "accountId" | "gatewayId" | "maxTokens"
  >,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<void> {
  const { models, model, apiKey } = resolveRuntimeModel(config);
  if (!model || !apiKey) return;
  const accepted = new AbortController();
  const signal = AbortSignal.any([
    accepted.signal,
    AbortSignal.timeout(MODEL_CONNECT_CHECK_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  const stream = reliableModelStream(
    models,
    model,
    CHECK_CONTEXT,
    withChatCompletionsCompatibility(
      model,
      withCloudflareAuth(config, {
        apiKey,
        signal,
        maxRetries: 0,
        maxTokens: MODEL_CONNECT_CHECK_MAX_TOKENS,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      }) ?? {},
    ),
    config.maxTokens,
  );
  // Providers emit `start` only after a successful HTTP response.
  for await (const event of stream) {
    if (event.type === "start") {
      accepted.abort();
      break;
    }
  }
  if (accepted.signal.aborted) return;
  options.signal?.throwIfAborted();
  const result = await stream.result();
  if (result.stopReason !== "error" || !result.errorMessage) return;
  const failure = normalizeRunError(result.errorMessage);
  if (failure.kind && BLOCKING_KINDS.has(failure.kind)) throw new Error(failure.summary);
}

/** A local model may load cold on its first prompt, so a test waits far longer than Connect. */
export const LOCAL_MODEL_TEST_TIMEOUT_MS = 60_000;

const TEST_CONTEXT: Context = {
  messages: [{ role: "user", content: "Hi", timestamp: 0 }],
};

/**
 * Send one tiny prompt with no tools and time it. It passes when the model answered without
 * ending in error; the reply text is never inspected. A model failure is a result, not a throw.
 */
export async function testModelOnce(
  config: Pick<
    AgentRunModel,
    | "provider"
    | "id"
    | "apiKey"
    | "accountId"
    | "gatewayId"
    | "baseUrl"
    | "headers"
    | "maxTokens"
    | "allowPrivateEndpoint"
  >,
  options: {
    fetch?: typeof globalThis.fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<LocalModelTest> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? LOCAL_MODEL_TEST_TIMEOUT_MS;
  const started = now();
  const failed = (message: string): LocalModelTest => ({
    ok: false,
    ms: now() - started,
    error: normalizeRunError(message).summary,
  });
  const { models, model, apiKey } = resolveRuntimeModel(config);
  if (!model) return failed("The model is not available.");
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  try {
    const stream = reliableModelStream(
      models,
      model,
      TEST_CONTEXT,
      withChatCompletionsCompatibility(
        model,
        withCloudflareAuth(config, {
          ...(apiKey ? { apiKey } : {}),
          signal,
          timeoutMs,
          maxRetries: 0,
          maxTokens: 16,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }) ?? {},
      ),
      config.maxTokens,
    );
    const pending = stream.result();
    pending.catch(() => undefined);
    const result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")), {
          once: true,
        });
      }),
    ]);
    if (result.stopReason === "error") return failed(result.errorMessage ?? "Model error");
    return { ok: true, ms: now() - started };
  } catch (error) {
    if (timedOut) return failed("Request timed out.");
    return failed(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}
