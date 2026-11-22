/** 1,234 reads as "1.2K"; small numbers stay whole. */
export function formatTokens(tokens: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    tokens,
  );
}
