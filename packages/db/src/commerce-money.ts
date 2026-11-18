/**
 * Money rules of partner commerce (docs/partner-commerce.md, 9.7). Pure and offline: integer minor
 * units and USD micros only, BigInt in the middle so a product never overflows, and every division
 * rounds down.
 */

const BPS = 10_000n;
const RATE_SCALE = 100_000_000n;
const MS_PER_DAY = 86_400_000;

/** `floor(value * numerator / denominator)` without floats. Non-negative inputs only. */
export function mulDiv(value: number, numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("Invalid denominator");
  return Number((BigInt(value) * BigInt(numerator)) / BigInt(denominator));
}

export interface RevenueSplit {
  baseMinor: number;
  rookShareMinor: number;
  partnerCommissionMinor: number;
  markupMinor: number;
}

/**
 * Rook's share of the catalog price is `base x (10000 - commissionBps) / 10000`, rounded down. The
 * partner's commission is the remainder, never computed on its own, so the two always add up to the
 * base exactly. The markup is whatever the customer paid above the base (a discount lowers only the
 * partner's side, never Rook's share).
 */
export function splitRevenue(
  baseMinor: number,
  commissionBps: number,
  paidMinor?: number | null,
): RevenueSplit {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0) throw new Error("Invalid base amount");
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error("Invalid commission");
  }
  const rookShareMinor = mulDiv(baseMinor, 10_000 - commissionBps, 10_000);
  return {
    baseMinor,
    rookShareMinor,
    partnerCommissionMinor: baseMinor - rookShareMinor,
    markupMinor: paidMinor == null ? 0 : Math.max(0, paidMinor - baseMinor),
  };
}

/** Proration rounds down per line: `amount x remainingDays / totalDays`. */
export function prorate(amountMinor: number, remainingDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return mulDiv(amountMinor, Math.max(0, Math.min(remainingDays, totalDays)), totalDays);
}

/**
 * Whole days left in a period when a change is made, the day of the change counted for the new
 * plan: from the start of the change's UTC day to the period's end.
 */
export function remainingPeriodDays(changeAt: Date, periodEnd: Date): number {
  const dayStart = Date.UTC(
    changeAt.getUTCFullYear(),
    changeAt.getUTCMonth(),
    changeAt.getUTCDate(),
  );
  return Math.max(0, Math.ceil((periodEnd.getTime() - dayStart) / MS_PER_DAY));
}

export function periodDays(periodStart: Date, periodEnd: Date): number {
  return Math.max(1, Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY));
}

/**
 * How much of `total` a refund of `cumulative` out of `paid` has reversed in all. The full amount
 * reverses exactly `total`, so any sequence of partial refunds sums to the original with no
 * rounding left over.
 */
export function reversedTarget(total: number, cumulativeRefunded: number, paid: number): number {
  if (paid <= 0) return 0;
  if (cumulativeRefunded >= paid) return total;
  return mulDiv(total, cumulativeRefunded, paid);
}

/** A decimal rate such as `5.12` as an integer with eight decimals (`512000000`). */
export function parseRateE8(rate: string): bigint {
  const match = /^(\d{1,10})(?:\.(\d{1,8})\d*)?$/.exec(rate.trim());
  if (!match) throw new Error("Invalid exchange rate");
  const value = BigInt(match[1]!) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(8, "0") || "0");
  if (value <= 0n) throw new Error("Invalid exchange rate");
  return value;
}

/**
 * The USD micros a credit in the partner's currency is worth when granted. USD is exact. Another
 * currency is divided by the locked rate and then reduced by the safety spread, rounded down, so
 * the customer never gets more USD of AI than the rate allows.
 */
export function creditMicros(input: {
  currency: string;
  creditMinor: number;
  rateE8?: bigint;
  spreadBps?: number;
}): bigint {
  const minor = BigInt(input.creditMinor);
  if (input.currency === "USD") return minor * 10_000n;
  if (!input.rateE8) throw new Error("An exchange rate is needed");
  const spread = BigInt(input.spreadBps ?? 0);
  if (spread < 0n || spread >= BPS) throw new Error("Invalid spread");
  return (minor * RATE_SCALE * (BPS - spread)) / input.rateE8;
}

/** What a part of a grant reads as, in the grant's currency, rounded down. */
export function minorOfMicros(grantMinor: number, grantMicros: bigint, micros: bigint): number {
  if (grantMicros <= 0n || micros <= 0n) return 0;
  return Number((BigInt(grantMinor) * micros) / grantMicros);
}

/** `YYYY-MM` of a moment in UTC. */
export function periodLabel(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The same day and time `months` later in UTC, clamped to the end of a shorter month. */
export function addMonthsUtc(at: Date, months: number): Date {
  const target = new Date(
    Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth() + months,
      1,
      at.getUTCHours(),
      at.getUTCMinutes(),
      at.getUTCSeconds(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(at.getUTCDate(), lastDay));
  return target;
}

export type SubscriptionState = "none" | "active" | "past_due" | "canceled" | "lapsed";

/**
 * What a customer's plan allows now. Active and trialing plans run until the period ends and then
 * for the grace period while the partner reports the renewal; a past-due plan runs for the grace
 * period from the first report; a canceled plan runs to the end of its period. Everything else is
 * lapsed ("Plan inactive"); reporting `active` with a current period restores it.
 */
export function subscriptionState(
  subscription: {
    status: string;
    periodEnd: Date;
    pastDueSince: Date | null;
  } | null,
  now: Date,
  graceDays: number,
): SubscriptionState {
  if (!subscription) return "none";
  const grace = graceDays * MS_PER_DAY;
  const end = subscription.periodEnd.getTime();
  const at = now.getTime();
  if (subscription.status === "canceled") return at < end ? "canceled" : "lapsed";
  if (subscription.status === "past_due") {
    const since = subscription.pastDueSince?.getTime() ?? at;
    return at < since + grace ? "past_due" : "lapsed";
  }
  if (at < end) return "active";
  return at < end + grace ? "past_due" : "lapsed";
}

/** Whether runs may start in a state. */
export function stateAllowsAccess(state: SubscriptionState): boolean {
  return state === "active" || state === "past_due" || state === "canceled";
}
