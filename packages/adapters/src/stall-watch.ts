import type { TurnGuardLimits } from "./turn-guard-calls.js";

export interface StallWatch {
  lastSignAt: number;
  lastTickAt: number;
  inFlight: number;
}

export function newStallWatch(now: number): StallWatch {
  return { lastSignAt: now, lastTickAt: now, inFlight: 0 };
}

export function stallSign(watch: StallWatch, now: number): void {
  watch.lastSignAt = now;
}

export function stallBegin(watch: StallWatch, now: number): void {
  watch.inFlight += 1;
  stallSign(watch, now);
}

export function stallEnd(watch: StallWatch, now: number): void {
  watch.inFlight = Math.max(0, watch.inFlight - 1);
  stallSign(watch, now);
}

/**
 * One watch tick. True when nothing is in flight and there has been no sign of life for longer
 * than `stallMs`. A gap between ticks far longer than the tick means the machine was suspended,
 * so the silence clock restarts instead of counting it.
 */
export function stallTick(
  watch: StallWatch,
  now: number,
  limits: Pick<TurnGuardLimits, "stallMs" | "stallTickMs">,
): boolean {
  if (now - watch.lastTickAt > limits.stallTickMs * 4 + 30_000 || now < watch.lastSignAt) {
    watch.lastSignAt = now;
  }
  watch.lastTickAt = now;
  return watch.inFlight === 0 && now - watch.lastSignAt > limits.stallMs;
}
