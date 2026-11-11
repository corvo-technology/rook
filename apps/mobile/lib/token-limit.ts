import { BOT_MONTHLY_TOKEN_LIMIT_MAX } from "@corvo/contracts";
import { t } from "./i18n";

/** A whole number of tokens typed in the limit field: null for empty or 0, undefined when unusable. */
export function parseTokenLimit(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (value === 0) return null;
  return value <= BOT_MONTHLY_TOKEN_LIMIT_MAX ? value : undefined;
}

/** "{used} of {limit}" with the numbers formatted for the locale. */
export function budgetLine(
  budget: { monthTokens: number; monthlyTokenLimit: number },
  locale: string,
): string {
  const numbers = new Intl.NumberFormat(locale);
  return t("{used} of {limit}", {
    used: numbers.format(budget.monthTokens),
    limit: numbers.format(budget.monthlyTokenLimit),
  });
}
