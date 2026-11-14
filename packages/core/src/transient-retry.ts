import { abortableDelay } from "./async.js";
import { parseRetryAfter } from "./retry-policy.js";

/** How long a safe request keeps retrying through a deploy swap before the user sees an error. */
export const TRANSIENT_RETRY_WINDOW_MS = 30_000;
const FIRST_DELAY_MS = 500;
const MAX_DELAY_MS = 4_000;

/** The proxy has no upstream (502), the API is draining (503), or the upstream timed out (504). */
export function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/**
 * Calls a retry may repeat. A send carries a client nonce the server de-duplicates on, so a
 * retry of one that did arrive returns the stored result instead of posting twice; the others are
 * idempotent by nature. 404 and 409 are never transient, so a deleted target is not retried.
 */
export function isRetrySafeCall(procedure: string, input: unknown): boolean {
  const name = procedure.replace(/^\/?(rpc\/)?/, "").replace(/\./g, "/");
  if (name === "threads/send" || name === "threads/react") {
    const nonce = (input as { clientNonce?: unknown } | null | undefined)?.clientNonce;
    return typeof nonce === "string" && nonce.length > 0;
  }
  return name === "threads/markRead" || name === "threads/stop";
}

/**
 * Sends again after a network failure or a 502, 503 or 504, backing off, until the window passes;
 * then the last failure surfaces unchanged. `send` must build a fresh request on every call.
 */
export async function retryTransient(
  send: () => Promise<Response>,
  options: {
    signal?: AbortSignal | null;
    windowMs?: number;
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    random?: () => number;
    /** Called once when the first retry is scheduled, and again with false when it ends. */
    onRetrying?: (retrying: boolean) => void;
  } = {},
): Promise<Response> {
  const windowMs = options.windowMs ?? TRANSIENT_RETRY_WINDOW_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableDelay;
  const random = options.random ?? Math.random;
  const signal = options.signal ?? undefined;
  const startedAt = now();
  let retrying = false;
  try {
    for (let attempt = 0; ; attempt += 1) {
      let failure: { error: unknown } | { response: Response };
      try {
        const response = await send();
        if (!isTransientStatus(response.status)) return response;
        failure = { response };
      } catch (error) {
        if (signal?.aborted) throw error;
        failure = { error };
      }
      const backoff = Math.min(FIRST_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
      const asked =
        "response" in failure
          ? parseRetryAfter(failure.response.headers.get("retry-after"))
          : undefined;
      const delay = Math.max(backoff * (1 + random() * 0.25), asked ?? 0);
      if (now() - startedAt + delay > windowMs) {
        if ("response" in failure) return failure.response;
        throw failure.error;
      }
      if ("response" in failure) void failure.response.body?.cancel().catch(() => undefined);
      if (!retrying) {
        retrying = true;
        options.onRetrying?.(true);
      }
      await sleep(delay, signal);
      if (signal?.aborted) throw signal.reason ?? new Error("Request canceled");
    }
  } finally {
    if (retrying) options.onRetrying?.(false);
  }
}
