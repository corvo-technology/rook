import type {
  AdapterContext,
  SpeechClip,
  VoiceProvider,
  VoiceSynthesizeRequest,
} from "@corvo/adapter-kit";
import { VoiceAccountError, VoiceProviderError } from "@corvo/adapter-kit";
import { isRetryableError } from "@corvo/core";
import { getLogger } from "@corvo/logging";

/** A reply is read sentence by sentence, so speech that is not back in this long is lost anyway. */
export const SPEAK_BUDGET_MS = 15_000;
/** The first try never takes the whole budget, so a retry still has time to answer. */
const FIRST_ATTEMPT_MS = 9_000;
const RETRY_BACKOFF_MS = 300;

const TIMEOUT_TEXT = /time(?:d)?[\s-]?out|deadline exceeded/i;

/**
 * A failure of the clock or the wire, whatever its message: a per-attempt timeout, a provider
 * that says it timed out (even inside a 4xx or 5xx body), or no response at all. Whether the
 * caller hung up is decided separately, by its own signal.
 */
export function isTransientSpeechError(error: unknown): boolean {
  if (error instanceof VoiceAccountError) return false;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return true;
    if (TIMEOUT_TEXT.test(error.message)) return true;
    if (error instanceof VoiceProviderError && error.detail && TIMEOUT_TEXT.test(error.detail)) {
      return true;
    }
  }
  return isRetryableError(error);
}

function describeError(error: unknown) {
  if (!(error instanceof Error)) return { reason: String(error) };
  const cause = error.cause;
  return {
    reason: error.message,
    name: error.name,
    cause:
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : cause === undefined
          ? undefined
          : String(cause),
  };
}

export interface SpeakResilience {
  /** A second speech model to try when the first fails twice; omitted means no fallback. */
  fallbackModel?: string;
  budgetMs?: number;
  backoffMs?: number;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Speaks, and when the provider fails for a passing reason (a timeout, 429, 5xx or the network)
 * asks once more, then once on the fallback model if the deployment set one. Never more than three
 * tries, and never past the budget, so a call is not left waiting on speech that will not come.
 * A refusal (bad key, no credit, bad request) is final: asking again only repeats it.
 */
export async function synthesizeResilient(
  provider: VoiceProvider,
  request: VoiceSynthesizeRequest,
  context: AdapterContext,
  options: SpeakResilience = {},
): Promise<SpeechClip> {
  const parent = request.signal ?? context.signal;
  const budget = AbortSignal.any([
    parent,
    AbortSignal.timeout(options.budgetMs ?? SPEAK_BUDGET_MS),
  ]);
  const started = Date.now();
  const attempts: Array<string | undefined> = [request.model, request.model];
  if (options.fallbackModel && options.fallbackModel !== request.model) {
    attempts.push(options.fallbackModel);
  }
  let lastError: unknown;
  for (const [index, model] of attempts.entries()) {
    const remaining = (options.budgetMs ?? SPEAK_BUDGET_MS) - (Date.now() - started);
    if (index > 0 && (budget.aborted || remaining <= 0)) break;
    const signal =
      index === 0
        ? AbortSignal.any([budget, AbortSignal.timeout(Math.min(remaining, FIRST_ATTEMPT_MS))])
        : budget;
    try {
      return await provider.synthesize(
        { ...request, ...(model ? { model } : {}), signal },
        { ...context, signal },
      );
    } catch (error) {
      lastError = error;
      // A refusal is the caller's account, not a fault; the route logs it once.
      if (!(error instanceof VoiceAccountError))
        getLogger().warn("voice provider failed to speak", {
          attempt: index + 1,
          model: model ?? "default",
          status: error instanceof VoiceProviderError ? error.status : undefined,
          detail: error instanceof VoiceProviderError ? error.detail : undefined,
          ...describeError(error),
          callerAborted: parent.aborted,
          budgetSpent: budget.aborted && !parent.aborted,
        });
      // The caller hung up or the budget is spent; a refusal is final.
      if (
        parent.aborted ||
        budget.aborted ||
        error instanceof VoiceAccountError ||
        !isTransientSpeechError(error)
      )
        break;
      if (index === 0) await sleep(options.backoffMs ?? RETRY_BACKOFF_MS, budget);
    }
  }
  throw lastError ?? new Error("Voice took too long to answer.");
}
