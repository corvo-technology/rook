import type { ComputerSize, PlanId } from "@corvo/contracts";
import { COMPUTER_SIZE_SPECS, storageLevel } from "@corvo/contracts";
import { t } from "@lingui/core/macro";

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** "12.5 GB", or megabytes below one gigabyte, in the viewer's number format. */
export function formatStorage(bytes: number, locale: string): string {
  const gigabytes = bytes >= GIB;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: gigabytes ? "gigabyte" : "megabyte",
    maximumFractionDigits: gigabytes && bytes < 100 * GIB ? 1 : 0,
  }).format(bytes / (gigabytes ? GIB : MIB));
}

export function planName(plan: PlanId): string {
  return { personal: t`Personal`, team: t`Team`, company: t`Company` }[plan];
}

export function computerSizeName(size: ComputerSize): string {
  return { small: t`Small`, medium: t`Medium`, large: t`Large` }[size];
}

/** "4 CPU · 8 GB · 20 GB": what a size gives, without words that repeat the interface. */
export function computerSizeSpec(size: ComputerSize, locale: string): string {
  const spec = COMPUTER_SIZE_SPECS[size];
  const memory = formatStorage(spec.memoryGb * GIB, locale);
  const disk = formatStorage(spec.diskGb * GIB, locale);
  return `${spec.cpu} CPU · ${memory} · ${disk}`;
}

/** "$5 per month": a price with its period, in the viewer's currency format. */
export function formatMoney(
  price: { amount: number; currency: string; interval: string },
  locale: string,
): string {
  const amount = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    maximumFractionDigits: price.amount % 100 === 0 ? 0 : 2,
  }).format(price.amount / 100);
  if (price.interval === "month") return t`${amount} per month`;
  if (price.interval === "year") return t`${amount} per year`;
  return amount;
}

/** Whole percent of the limit used, capped at 100. */
export function storagePercent(usedBytes: number, limitBytes: number): number {
  return Math.min(100, Math.floor((usedBytes / limitBytes) * 100));
}

export { storageLevel };
