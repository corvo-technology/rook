import type { UsageCache, UsageOverview } from "@corvo/contracts";

/** How this period compares with the one before, as a signed fraction; null when there is nothing to compare. */
export function usageChange(
  overview: Pick<UsageOverview, "tokens" | "previousTokens">,
): number | null {
  if (overview.previousTokens <= 0) return null;
  return (overview.tokens - overview.previousTokens) / overview.previousTokens;
}

/** An agent's share of the period's tokens, 0 to 1. */
export function usageShare(tokens: number, total: number): number {
  return total > 0 ? Math.min(1, tokens / total) : 0;
}

export type UsageBar = {
  date: string;
  tokens: number;
  /** Height of the whole day, 0 to 1 of the tallest day. */
  height: number;
  /** Part of that height that belongs to the chosen agent, 0 to 1; the whole bar when none is chosen. */
  focus: number;
};

/** The chart's bars. With an agent chosen, only its tokens stay in ink and the rest of the day fades. */
export function usageBars(days: UsageOverview["days"], agentKey: string | null): UsageBar[] {
  const peak = Math.max(0, ...days.map((day) => day.tokens));
  return days.map((day) => {
    const height = peak > 0 ? day.tokens / peak : 0;
    const own = agentKey === null ? day.tokens : (day.agents[agentKey] ?? 0);
    return {
      date: day.date,
      tokens: day.tokens,
      height,
      focus: day.tokens > 0 ? own / day.tokens : 0,
    };
  });
}

/** The key an agent has in a day's breakdown. */
export const usageAgentKey = (id: string | null): string => id ?? "none";

/** A UTC day written for a person, in their language. */
export function usageDayLabel(date: string, locale: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Share of the input that came from the prompt cache, 0 to 1; null when nothing went in. */
export function usageHitRate(cache: UsageCache): number | null {
  const input = cache.input + cache.cacheRead + cache.cacheWrite;
  return input > 0 ? cache.cacheRead / input : null;
}
