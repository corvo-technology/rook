/** A reply may spend this share of the bot's monthly limit. */
export const REPLY_CAP_SHARE = 0.1;
/** Without a monthly limit the reply share is taken over this many tokens, so a reply still ends. */
export const NO_LIMIT_REPLY_BASE = 50_000_000;
/** A reply that passes its cap by this factor is cut even if it calls no tool. */
export const REPLY_CAP_OVERRUN = 1.3;
/** Tool calls refused past the cap before the reply is cut. */
export const REPLY_CAP_REFUSED_CALLS = 3;
/** The share of the month at which the owner is warned. */
export const MONTH_ALERT_SHARE = 0.8;

type Limit = number | null | undefined;

/** Tokens a bot may use in a month. `Infinity` unless the limit is a finite number above zero. */
export function monthlyCeiling(limit: Limit): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? limit
    : Number.POSITIVE_INFINITY;
}

export function replyCap(limit: Limit): number {
  const ceiling = monthlyCeiling(limit);
  return Math.round((Number.isFinite(ceiling) ? ceiling : NO_LIMIT_REPLY_BASE) * REPLY_CAP_SHARE);
}

export function monthlyLimitReached(used: number, limit: Limit): boolean {
  return used >= monthlyCeiling(limit);
}

/** True only when `before < 80% of limit <= after < limit`. */
export function crossedMonthAlert(before: number, after: number, limit: Limit): boolean {
  const ceiling = monthlyCeiling(limit);
  if (!Number.isFinite(ceiling)) return false;
  const alert = MONTH_ALERT_SHARE * ceiling;
  return before < alert && alert <= after && after < ceiling;
}

/** Tokens of one call: what the provider totalled, else what went in and out, else 0. */
export function usageTokens(row: {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}): number {
  return row.totalTokens ?? (row.inputTokens ?? 0) + (row.outputTokens ?? 0);
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function utcMonthKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
