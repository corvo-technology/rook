import { MAX_RETRY_AFTER_MS, parseRetryAfter } from "@corvo/core";

/** How long a model that failed without saying when to come back is left alone. */
export const DEFAULT_MODEL_COOLDOWN_MS = 30_000;

/** The Retry-After a provider answered with, header names compared without case. */
export function retryAfterFromHeaders(
  headers: Record<string, string> | undefined,
  now = Date.now(),
): number | undefined {
  if (!headers) return undefined;
  const name = Object.keys(headers).find((key) => key.toLowerCase() === "retry-after");
  return name ? parseRetryAfter(headers[name], now) : undefined;
}

/**
 * Models that just failed, and until when they should not be asked again. Failover reads it so
 * a backup that is itself rate limited is passed over instead of hammered. One registry per
 * runtime: the clock is injectable so tests never wait.
 */
export class ModelCooldowns {
  private readonly until = new Map<string, number>();

  constructor(private readonly clock: () => number = Date.now) {}

  start(key: string, retryAfterMs?: number): void {
    const wait = Math.min(retryAfterMs ?? DEFAULT_MODEL_COOLDOWN_MS, MAX_RETRY_AFTER_MS);
    this.until.set(key, this.clock() + Math.max(wait, 0));
  }

  remainingMs(key: string): number {
    const end = this.until.get(key);
    if (end === undefined) return 0;
    const remaining = end - this.clock();
    if (remaining <= 0) this.until.delete(key);
    return Math.max(remaining, 0);
  }

  /** A call to this model worked, so whatever cooled it down is over. */
  clear(key: string): void {
    this.until.delete(key);
  }
}
