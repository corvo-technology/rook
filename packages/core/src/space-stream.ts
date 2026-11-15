import type { SpaceHint, SpaceHintKind } from "@corvo/contracts";
import { SPACE_HINT_KINDS } from "@corvo/contracts";
import { abortableDelay } from "./async.js";
import { isRetryableError, retryDelayMs } from "./retry-policy.js";

/** The server beats every 20 s; this long with no frame at all means the stream is half-open. */
export const SPACE_STREAM_IDLE_MS = 45_000;
/** How often a list is read again with no hint at all, in case one was missed. */
export const SPACE_FALLBACK_REFETCH_MS = 60_000;

/**
 * Keeps one member's space stream open and calls `onHint` for each invalidation hint. Every
 * (re)connection asks for every kind once, because hints sent while it was down are gone. A 401 or
 * other refusal stops the loop: asking again cannot change the answer.
 */
export async function runSpaceStream(options: {
  signal: AbortSignal;
  subscribe: (signal: AbortSignal) => Promise<AsyncIterable<SpaceHint>>;
  onHint: (kind: SpaceHintKind) => void;
}): Promise<void> {
  const { signal } = options;
  let retryMs = 250;
  while (!signal.aborted) {
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    signal.addEventListener("abort", stop, { once: true });
    let failure: unknown;
    try {
      const frames = await options.subscribe(attempt.signal);
      for (const kind of SPACE_HINT_KINDS) options.onHint(kind);
      const iterator = frames[Symbol.asyncIterator]();
      try {
        let pending: Promise<IteratorResult<SpaceHint>> | undefined;
        while (!signal.aborted) {
          pending ??= iterator.next();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const next = await Promise.race([
            pending,
            new Promise<"idle">((resolve) => {
              timer = setTimeout(() => resolve("idle"), SPACE_STREAM_IDLE_MS);
            }),
            new Promise<"stopped">((resolve) => {
              attempt.signal.addEventListener("abort", () => resolve("stopped"), { once: true });
            }),
          ]).finally(() => clearTimeout(timer));
          if (next === "idle" || next === "stopped" || next.done) break;
          pending = undefined;
          retryMs = 250;
          if (next.value.kind !== "heartbeat") options.onHint(next.value.kind);
        }
      } finally {
        attempt.abort();
        void iterator.return?.(undefined)?.catch?.(() => {});
      }
    } catch (error) {
      failure = error;
    } finally {
      attempt.abort();
      signal.removeEventListener("abort", stop);
    }
    if (signal.aborted) return;
    if (failure !== undefined && !isRetryableError(failure)) return;
    await abortableDelay(retryDelayMs(failure, retryMs), signal);
    retryMs = Math.min(retryMs * 2, 5_000);
  }
}
