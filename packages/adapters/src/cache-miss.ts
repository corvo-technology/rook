import type { AgentUsage } from "@corvo/adapter-kit";

/** Why a model call read nothing from the prompt cache. */
export type CacheMissReason =
  | "first_call"
  | "model_changed"
  | "expired"
  | "below_minimum"
  | "unexplained";

export interface CacheCounters {
  calls: number;
  hits: number;
  misses: number;
  byReason: Partial<Record<CacheMissReason, number>>;
}

const SHORT_TTL_MS = 5 * 60_000;
const LONG_TTL_MS = 60 * 60_000;
/** Providers do not cache prompts shorter than this. */
const MIN_CACHEABLE_TOKENS = 1_024;

/**
 * Follows one run's model calls and names the cause of every call that did not reuse the
 * cache, so a regression shows up as a count per reason instead of a guess from the bill.
 */
export class CacheMissTracker {
  readonly counters: CacheCounters = { calls: 0, hits: 0, misses: 0, byReason: {} };
  private previous: { model: string; at: number; ttlMs: number } | undefined;

  /** The reason this call missed, or undefined when it read from the cache or reports no cache. */
  observe(
    usage: Pick<AgentUsage, "inputTokens" | "cacheReadTokens" | "cacheWriteTokens"> & {
      cacheWrite1hTokens?: number | null;
    },
    model: string,
    now = Date.now(),
  ): CacheMissReason | undefined {
    // A provider that reports no cache measurement cannot be judged.
    if (usage.cacheReadTokens == null) return undefined;
    this.counters.calls += 1;
    const before = this.previous;
    this.previous = {
      model,
      at: now,
      ttlMs: (usage.cacheWrite1hTokens ?? 0) > 0 ? LONG_TTL_MS : SHORT_TTL_MS,
    };
    if (usage.cacheReadTokens > 0) {
      this.counters.hits += 1;
      return undefined;
    }
    const reason: CacheMissReason = !before
      ? "first_call"
      : before.model !== model
        ? "model_changed"
        : now - before.at > before.ttlMs
          ? "expired"
          : (usage.inputTokens ?? 0) < MIN_CACHEABLE_TOKENS
            ? "below_minimum"
            : "unexplained";
    this.counters.misses += 1;
    this.counters.byReason[reason] = (this.counters.byReason[reason] ?? 0) + 1;
    return reason;
  }
}
