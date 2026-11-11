import type { UsageOverview, UsagePeriod } from "@corvo/contracts";
import { normalizeRunError, usageTokens } from "@corvo/core";

export interface UsageRow {
  botId: string | null;
  createdAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  provider: string;
  model: string;
  runId: string | null;
  parentRunId: string | null;
}

const DAY_MS = 86_400_000;
const NO_AGENT = "none";

const startOfUtcDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;
const startOfUtcMonth = (time: number, offset = 0) => {
  const d = new Date(time);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
};

/**
 * The window a period covers and the window it is compared with. The comparison is the same
 * stretch of the period before, so the middle of a month is not set against a whole one.
 */
export function usageWindow(period: UsagePeriod, now: Date) {
  const time = now.getTime();
  let from: number;
  let to: number;
  let previousFrom: number;
  if (period === "30d") {
    to = time;
    from = startOfUtcDay(time) - 29 * DAY_MS;
    previousFrom = from - 30 * DAY_MS;
  } else if (period === "last-month") {
    from = startOfUtcMonth(time, -1);
    to = startOfUtcMonth(time);
    previousFrom = startOfUtcMonth(time, -2);
  } else {
    from = startOfUtcMonth(time);
    to = time;
    previousFrom = startOfUtcMonth(time, -1);
  }
  const previousTo = Math.min(previousFrom + (to - from), from);
  return { from, to, previousFrom, previousTo };
}

/** Tokens of one call: what the provider totalled, else what went in and out. */
export const rowTokens = (row: UsageRow): number => usageTokens(row);

export interface RunOutcomeRow {
  botId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  error?: string | null;
}
export type RunOutcome = {
  failed: number;
  avgSeconds: number | null;
  /** The error text behind the most common kind of failure, for the page to put in words. */
  topError: string | null;
};
const TOP_ERROR_CHARS = 1_000;

/** How each agent's ended runs went: how many failed, and how long the finished ones took. */
export function buildRunOutcomes(runs: readonly RunOutcomeRow[]): Map<string, RunOutcome> {
  const totals = new Map<
    string,
    {
      failed: number;
      seconds: number;
      timed: number;
      reasons: Map<string, { count: number; error: string }>;
    }
  >();
  for (const run of runs) {
    const total = totals.get(run.botId) ?? { failed: 0, seconds: 0, timed: 0, reasons: new Map() };
    if (run.status === "failed") {
      total.failed += 1;
      const error = run.error?.trim();
      if (error) {
        // Runs fail for the same reason in different words; the app's own summary groups them.
        const reason = normalizeRunError(error).summary;
        const seen = total.reasons.get(reason);
        if (seen) seen.count += 1;
        else total.reasons.set(reason, { count: 1, error: error.slice(0, TOP_ERROR_CHARS) });
      }
    }
    if (run.status === "completed" && run.startedAt && run.completedAt) {
      total.seconds += (run.completedAt.getTime() - run.startedAt.getTime()) / 1000;
      total.timed += 1;
    }
    totals.set(run.botId, total);
  }
  return new Map(
    [...totals].map(([botId, total]) => [
      botId,
      {
        failed: total.failed,
        avgSeconds: total.timed ? total.seconds / total.timed : null,
        topError: [...total.reasons.values()].sort((a, b) => b.count - a.count)[0]?.error ?? null,
      },
    ]),
  );
}

/** Folds a period's usage rows into the overview the usage page draws. Pure, so it is easy to check. */
export function buildUsageOverview(input: {
  period: UsagePeriod;
  now: Date;
  /** Rows from the start of the comparison window to now. */
  rows: readonly UsageRow[];
  agents: ReadonlyMap<string, { name: string; color: string | null }>;
  /** What to call spend whose agent no longer exists. */
  unknownName: string;
  outcomes?: ReadonlyMap<string, RunOutcome>;
}): UsageOverview {
  const { period, now, rows, agents, unknownName, outcomes } = input;
  const window = usageWindow(period, now);
  const end = Math.max(window.to, window.from + 1);
  const inWindow = rows.filter((row) => {
    const at = row.createdAt.getTime();
    return at >= window.from && at < end;
  });
  const previousTokens = rows
    .filter((row) => {
      const at = row.createdAt.getTime();
      return at >= window.previousFrom && at < window.previousTo;
    })
    .reduce((sum, row) => sum + rowTokens(row), 0);

  type Bucket = {
    id: string | null;
    tokens: number;
    runs: Set<string>;
    cost: number;
    costKnown: boolean;
    models: Map<string, { provider: string; model: string; tokens: number }>;
  };
  const buckets = new Map<string, Bucket>();
  const allRuns = new Set<string>();
  let cost = 0;
  let costKnown = true;
  let tokens = 0;
  const days = new Map<string, { tokens: number; agents: Record<string, number> }>();
  // The running month shows all its days, so a few days of use sit at the start of the axis
  // and not stretched across the whole chart.
  const daysEnd = period === "month" ? startOfUtcMonth(now.getTime(), 1) : end;
  for (let day = startOfUtcDay(window.from); day < daysEnd; day += DAY_MS) {
    days.set(new Date(day).toISOString().slice(0, 10), { tokens: 0, agents: {} });
  }

  for (const row of inWindow) {
    const key = row.botId ?? NO_AGENT;
    const used = rowTokens(row);
    const bucket = buckets.get(key) ?? {
      id: row.botId,
      tokens: 0,
      runs: new Set<string>(),
      cost: 0,
      costKnown: true,
      models: new Map(),
    };
    bucket.tokens += used;
    const run = row.parentRunId ?? row.runId;
    if (run) {
      bucket.runs.add(run);
      allRuns.add(run);
    }
    if (row.costUsd == null) {
      bucket.costKnown = false;
      costKnown = false;
    } else {
      bucket.cost += row.costUsd;
      cost += row.costUsd;
    }
    const modelKey = `${row.provider}:${row.model}`;
    const model = bucket.models.get(modelKey) ?? {
      provider: row.provider,
      model: row.model,
      tokens: 0,
    };
    model.tokens += used;
    bucket.models.set(modelKey, model);
    buckets.set(key, bucket);
    tokens += used;
    const day = days.get(row.createdAt.toISOString().slice(0, 10));
    if (day) {
      day.tokens += used;
      day.agents[key] = (day.agents[key] ?? 0) + used;
    }
  }

  return {
    period,
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
    tokens,
    previousTokens,
    replies: allRuns.size,
    costUsd: costKnown ? cost : null,
    agents: [...buckets.entries()]
      .map(([key, bucket]) => {
        const known = key === NO_AGENT ? undefined : agents.get(key);
        return {
          id: bucket.id,
          name: known?.name ?? unknownName,
          color: known?.color ?? null,
          tokens: bucket.tokens,
          replies: bucket.runs.size,
          costUsd: bucket.costKnown ? bucket.cost : null,
          models: [...bucket.models.values()].sort((a, b) => b.tokens - a.tokens),
          ...(bucket.id && outcomes?.get(bucket.id) ? outcomes.get(bucket.id) : {}),
        };
      })
      .sort((a, b) => b.tokens - a.tokens),
    days: [...days.entries()].map(([date, value]) => ({ date, ...value })),
  };
}
