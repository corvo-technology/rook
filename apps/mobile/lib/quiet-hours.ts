import type { QuietHours } from "@corvo/contracts";

/** The night a person gets until they choose their own: 22:00 to 08:00. */
export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, start: 22 * 60, end: 8 * 60 };

/** Minutes after local midnight as a Date today at that time, for a time picker. */
export function minutesToDate(minutes: number, base: Date = new Date()): Date {
  const date = new Date(base);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

/** A picked time as minutes after local midnight. */
export function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
