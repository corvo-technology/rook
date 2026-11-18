import type { PrismaClient } from "./client.js";
import { mulDiv, splitRevenue } from "./commerce-money.js";

/**
 * What a partner adds to a catalog price (docs/partner-commerce.md, sections 6 and 14). Pure and
 * offline except `readPartnerMarkups`: integer minor units, every division rounds down.
 */

/** The most a markup may be: 100% of the base, as basis points or, for a fixed one, minor units. */
export const MAX_MARKUP_BPS = 10_000;

export type MarkupKind = "fixed" | "percent";
export type MarkupItemKind = "plan" | "pack";

/** `value` is minor units for "fixed" and basis points (1500 is 15%) for "percent". */
export interface MarkupRule {
  kind: MarkupKind;
  value: number;
}

/** The id the console and agents use for a plan or a pack, such as `plan:team`. */
export const markupItemId = (itemKind: MarkupItemKind, itemKey: string) => `${itemKind}:${itemKey}`;

export function parseMarkupItemId(
  id: string,
): { itemKind: MarkupItemKind; itemKey: string } | null {
  const match = /^(plan|pack):([a-z0-9][a-z0-9_-]{0,39})$/.exec(id);
  return match ? { itemKind: match[1] as MarkupItemKind, itemKey: match[2] as string } : null;
}

/** What the markup adds to a base price, in minor units. */
export function markupMinor(baseMinor: number, rule?: MarkupRule | null): number {
  if (!rule || rule.value <= 0) return 0;
  return rule.kind === "fixed" ? rule.value : mulDiv(baseMinor, rule.value, 10_000);
}

/** What is wrong with a markup on a base price, or null when it is fine. */
export function markupError(baseMinor: number, rule: MarkupRule): string | null {
  if (rule.kind !== "fixed" && rule.kind !== "percent") return "kind";
  if (!Number.isSafeInteger(rule.value) || rule.value < 0) return "value";
  const cap = rule.kind === "fixed" ? baseMinor : MAX_MARKUP_BPS;
  return rule.value > cap ? "cap" : null;
}

export interface PricedItem {
  baseMinor: number;
  /** The partner's share of the base. Rook's share is `baseMinor - commissionMinor`. */
  commissionMinor: number;
  markupMinor: number;
  /** What the customer pays: the base plus the markup. The commission is part of the base. */
  finalMinor: number;
}

export function priceItem(
  baseMinor: number,
  commissionBps: number,
  rule?: MarkupRule | null,
): PricedItem {
  const split = splitRevenue(baseMinor, commissionBps);
  const markup = markupMinor(baseMinor, rule);
  return {
    baseMinor,
    commissionMinor: split.partnerCommissionMinor,
    markupMinor: markup,
    finalMinor: baseMinor + markup,
  };
}

/**
 * What a customer's subscription costs now: the price it was sold at (its snapshot) until the
 * period ends, and the item's current price once it renews.
 */
export function subscriptionPriceMinor(
  subscription: { baseMinor: number; markupMinor: number; periodEnd: Date },
  currentFinalMinor: number,
  now: Date,
): number {
  return now.getTime() < subscription.periodEnd.getTime()
    ? subscription.baseMinor + subscription.markupMinor
    : currentFinalMinor;
}

/** The partner's markups by item id. Call with a client that runs as the system. */
export async function readPartnerMarkups(
  prisma: PrismaClient,
  partnerId: string,
): Promise<Map<string, MarkupRule>> {
  const rows = await prisma.partnerMarkup.findMany({ where: { partnerId } });
  return new Map(
    rows.map((row) => [
      markupItemId(row.itemKind as MarkupItemKind, row.itemKey),
      { kind: row.kind as MarkupKind, value: row.value },
    ]),
  );
}
