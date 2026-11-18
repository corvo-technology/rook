import type { PartnerPricingConfig } from "@corvo/contracts";
import { CREDIT_MICROS } from "./partner-pricing.js";

/**
 * The rules of the embedded credit model as pure functions, so every one is tested without a
 * database. One credit is one US cent of the fund: 10,000 micro-dollars.
 */
const BPS = 10_000n;

/** `YYYY-MM` in UTC. */
export const creditPeriod = (now: Date) =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

export const creditPeriodStart = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const creditPeriodEnd = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** An empty list allows every model; a name matches the model id alone or `provider/model`. */
export function modelAllowed(allowed: readonly string[], provider: string, modelId: string) {
  if (allowed.length === 0) return true;
  return allowed.includes(modelId) || allowed.includes(`${provider}/${modelId}`);
}

/** The customer has spent its month's limit; a null limit never blocks. */
export function creditLimitReached(usedMicros: bigint, limitCredits: number | null) {
  return limitCredits !== null && usedMicros >= BigInt(limitCredits) * CREDIT_MICROS;
}

/** The fund is under `lowBalanceBps` of what it was filled with this period. */
export function fundIsLow(balanceMicros: bigint, referenceMicros: bigint, lowBalanceBps: number) {
  if (referenceMicros <= 0n || lowBalanceBps <= 0) return false;
  return balanceMicros * BPS < referenceMicros * BigInt(lowBalanceBps);
}

/** The fund is under the partner's auto top-up threshold, in credits. */
export function fundBelowThreshold(balanceMicros: bigint, thresholdCredits: number) {
  return balanceMicros < BigInt(thresholdCredits) * CREDIT_MICROS;
}

/** Minutes to wait after the nth failed attempt: 15 minutes, doubling, at most a day. */
export function topupBackoffMinutes(attempts: number) {
  return Math.min(24 * 60, 15 * 2 ** Math.max(0, attempts - 1));
}

export const MAX_TOPUP_ATTEMPTS = 6;

export type DebitedResource = "voice" | "computer" | "storage";

const scaled = (units: number, perUnitMicros: number) =>
  (BigInt(Math.floor(units * 1_000_000)) * BigInt(perUnitMicros)) / 1_000_000n;
const withMargin = (cost: bigint, bps: number) => (cost * (BPS + BigInt(bps))) / BPS;

/**
 * Credits owed for one resource at the published rates: provider cost plus Rook's margin, rounded
 * up so use is never under-counted. Storage is the GB kept in the month; only what is above the
 * allowance is charged. Voice and computer are in minutes.
 */
export function resourceCredits(
  config: PartnerPricingConfig,
  resource: DebitedResource,
  units: number,
): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  let charged: bigint;
  if (resource === "voice") {
    charged = withMargin(scaled(units, config.costs.voiceMinuteMicros), config.margins.voiceBps);
  } else if (resource === "computer") {
    charged = withMargin(
      scaled(units, config.costs.computerMinuteMicros),
      config.margins.computerMinuteBps,
    );
  } else {
    const billable = Math.max(0, units - config.storageAllowanceGb);
    charged = withMargin(
      scaled(billable, config.costs.storageGbMonthMicros),
      config.margins.storageBps,
    );
  }
  return Number((charged + CREDIT_MICROS - 1n) / CREDIT_MICROS);
}

/** The ledger source of a resource debit; the part after `hold:` is the hold's own name. */
export const resourceHoldId = (resource: DebitedResource, organizationId: string, key: string) =>
  `resource:${resource}:${organizationId}:${key}`;

/** Plan credits end with the period; a top-up follows the configured expiry, or never ends. */
export function splitFund(
  lots: Array<{ source: string; availableMicros: bigint; expiresAt: Date | null }>,
  now: Date,
) {
  let plan = 0n;
  let topup = 0n;
  for (const lot of lots) {
    if (lot.expiresAt && lot.expiresAt <= now) continue;
    if (lot.source.startsWith("purchase:partner-plan:")) plan += lot.availableMicros;
    else topup += lot.availableMicros;
  }
  return { planMicros: plan, topupMicros: topup };
}
