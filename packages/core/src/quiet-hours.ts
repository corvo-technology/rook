import type { MuteDuration, QuietHours } from "@corvo/contracts";
import { wallClock, zonedDateTime } from "./cron.js";

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, start: 22 * 60, end: 8 * 60 };

/** Proactive pushes one agent may send one person in a local day; the rest wait for the digest. */
export const DAILY_PROACTIVE_PUSH_CAP = 6;

function minuteOfDay(instant: Date, timezone: string): number {
  const [hour, minute] = wallClock(instant, timezone).slice(11, 16).split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/** The person's local date, "2026-11-20". */
export function localDay(instant: Date, timezone: string): string {
  return wallClock(instant, timezone).slice(0, 10);
}

/** Whether it is inside the quiet window where the person is. Off, or a window of no length, is never. */
export function isQuietNow(quiet: QuietHours, timezone: string, now: Date): boolean {
  if (!quiet.enabled || quiet.start === quiet.end) return false;
  const minute = minuteOfDay(now, timezone);
  return quiet.start < quiet.end
    ? minute >= quiet.start && minute < quiet.end
    : minute >= quiet.start || minute < quiet.end;
}

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`;
}

function nextDate(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The next time the local clock reads `minute`, after `now`. A time a daylight-saving change
 * skips moves forward by the gap, so the instant is always one that exists.
 */
export function nextLocalTime(minute: number, timezone: string, now: Date): Date {
  const today = localDay(now, timezone);
  const candidate = zonedDateTime(`${today}T${clock(minute)}`, timezone);
  if (candidate && candidate.getTime() > now.getTime()) return candidate;
  return (
    zonedDateTime(`${nextDate(today)}T${clock(minute)}`, timezone) ??
    new Date(now.getTime() + 864e5)
  );
}

/** When held pushes go out as one summary: the morning the quiet window ends, kept even with it off. */
export function nextDigestTime(quiet: QuietHours, timezone: string, now: Date): Date {
  return nextLocalTime(quiet.end, timezone, now);
}

/** When a mute ends; null never ends. */
export function muteUntil(
  duration: MuteDuration,
  quiet: QuietHours,
  timezone: string,
  now: Date,
): Date | null {
  if (duration === "forever") return null;
  if (duration === "hour") return new Date(now.getTime() + 3_600_000);
  const morning = nextLocalTime(quiet.end, timezone, now);
  // Tomorrow's morning, not today's, when it is still the small hours.
  return localDay(morning, timezone) === localDay(now, timezone)
    ? nextLocalTime(quiet.end, timezone, new Date(morning.getTime() + 60_000))
    : morning;
}

/** Runs no person started: they push only within quiet hours and the daily cap. */
export function isProactiveRunTrigger(trigger: string): boolean {
  return (
    trigger === "routine" ||
    trigger === "webhook" ||
    trigger === "bot_message" ||
    trigger === "cloud_agent"
  );
}
