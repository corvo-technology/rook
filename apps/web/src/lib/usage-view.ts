import type { UsageCache, UsageFailureKind, UsageOverview } from "@corvo/contracts";

/** What the page counts: money when any was spent, otherwise tokens (calls with no price). */
export type UsageMetric = "spend" | "tokens";

/** Money spent in the period, from every source. */
export const usageSpendTotal = (overview: Pick<UsageOverview, "spend">): number =>
  (overview.spend?.creditsUsd ?? 0) + (overview.spend?.ownUsd ?? 0);

export const usageMetric = (overview: Pick<UsageOverview, "spend">): UsageMetric =>
  usageSpendTotal(overview) > 0 ? "spend" : "tokens";

/** How this period compares with the one before, as a signed fraction; null when there is nothing to compare. */
export function usageChange(
  overview: Pick<UsageOverview, "tokens" | "previousTokens" | "spend" | "previousSpendUsd">,
): number | null {
  if (usageMetric(overview) === "spend") {
    const previous = overview.previousSpendUsd ?? 0;
    return previous > 0 ? (usageSpendTotal(overview) - previous) / previous : null;
  }
  if (overview.previousTokens <= 0) return null;
  return (overview.tokens - overview.previousTokens) / overview.previousTokens;
}

/** Dollars for a person: never "$0.00" for a real but tiny amount. */
export function formatUsd(value: number, locale: string): string {
  const format = (amount: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(amount);
  return value > 0 && value < 0.01 ? `<${format(0.01)}` : format(value);
}

/** The agents worth a row: those that answered or spent something. */
export const USAGE_ROWS_SHOWN = 8;

/** The first rows to show and how many are folded behind "more". */
export function usageFold<T>(items: readonly T[], limit = USAGE_ROWS_SHOWN) {
  return { shown: items.slice(0, limit), rest: items.slice(limit) };
}

/** Agents that did something in the period, biggest spender first. */
export function usageActiveAgents(agents: UsageOverview["agents"]): UsageOverview["agents"] {
  return agents
    .filter((agent) => agent.replies > 0 || (agent.spendUsd ?? 0) > 0)
    .sort((a, b) => (b.spendUsd ?? 0) - (a.spendUsd ?? 0) || b.tokens - a.tokens);
}

/** Failure kinds with a count, most common first. */
export function usageFailureKinds(
  kinds: Partial<Record<UsageFailureKind, number>> | undefined,
): Array<[UsageFailureKind, number]> {
  return (Object.entries(kinds ?? {}) as Array<[UsageFailureKind, number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** An agent's share of the period's tokens, 0 to 1. */
export function usageShare(tokens: number, total: number): number {
  return total > 0 ? Math.min(1, tokens / total) : 0;
}

export type UsageBar = {
  date: string;
  /** Spend in dollars or tokens, whichever the chart counts. */
  value: number;
  /** Height of the whole day, 0 to 1 of the tallest day. */
  height: number;
  /** Part of that height that belongs to the chosen agent, 0 to 1; the whole bar when none is chosen. */
  focus: number;
};

/** The chart's bars. With an agent chosen, only its share stays in ink and the rest of the day fades. */
export function usageBars(
  days: UsageOverview["days"],
  agentKey: string | null,
  metric: UsageMetric = "tokens",
): UsageBar[] {
  const whole = (day: UsageOverview["days"][number]) =>
    metric === "spend" ? (day.spendUsd ?? 0) : day.tokens;
  const part = (day: UsageOverview["days"][number], key: string) =>
    metric === "spend" ? (day.agentSpendUsd?.[key] ?? 0) : (day.agents[key] ?? 0);
  const peak = Math.max(0, ...days.map(whole));
  return days.map((day) => {
    const value = whole(day);
    const own = agentKey === null ? value : part(day, agentKey);
    return {
      date: day.date,
      value,
      height: peak > 0 ? value / peak : 0,
      focus: value > 0 ? Math.min(1, own / value) : 0,
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
