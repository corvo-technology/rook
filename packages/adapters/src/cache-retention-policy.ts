import { nextCronDateAcross } from "@corvo/core";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { resolvePiCacheRetention } from "./pi-cache-retention.js";

/** The short cache lives about five minutes; paying for the long one only helps beyond that. */
const SHORT_CACHE_MINUTES = 5;
const LONG_CACHE_MINUTES = 60;

export type CacheReturn = "soon" | "later";

type RoutineCadence = {
  crons?: readonly string[];
  timezone?: string | null;
  watchEveryMinutes?: number | null;
};

/** Minutes between two firings, or undefined when the routine has no repeating cadence. */
export function routineGapMinutes(routine: RoutineCadence, from: Date): number | undefined {
  if (routine.watchEveryMinutes) return routine.watchEveryMinutes;
  if (!routine.crons?.length) return undefined;
  try {
    const first = nextCronDateAcross([...routine.crons], from, routine.timezone ?? "UTC");
    const second =
      first && nextCronDateAcross([...routine.crons], first, routine.timezone ?? "UTC");
    return first && second ? (second.getTime() - first.getTime()) / 60_000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decide once per run whether it is likely to be picked up again after the short cache expired.
 * A one-hour write costs more than a five-minute one, so it is only worth it when the next call
 * lands between five minutes and an hour later. Interactive back-and-forth stays short.
 */
export function cacheReturnFor(run: {
  /** Resumed after an approval, takeover or other wait, and likely to wait again. */
  resumed?: boolean;
  /** A continuation or review run of a ticket. */
  ticket?: boolean;
  /** Minutes between this routine's runs, when it is one. */
  routineGapMinutes?: number;
}): CacheReturn {
  if (run.resumed || run.ticket) return "later";
  const gap = run.routineGapMinutes;
  return gap !== undefined && gap >= SHORT_CACHE_MINUTES && gap <= LONG_CACHE_MINUTES
    ? "later"
    : "soon";
}

/**
 * The retention one run sends on every call. A connection that declares a mode keeps it. Otherwise
 * a run that comes back later asks for the long cache when the protocol supports it and falls
 * back to the default when it does not, so this never makes a call fail. Fixed for the whole run:
 * switching retention mid-run would rewrite the cached prefix.
 */
export function runCacheRetention(
  model: Pick<Model<Api>, "api" | "compat">,
  declared: SimpleStreamOptions["cacheRetention"],
  cacheReturn: CacheReturn | undefined,
): SimpleStreamOptions["cacheRetention"] {
  if (declared !== undefined || cacheReturn !== "later") return declared;
  try {
    return resolvePiCacheRetention(model, "long");
  } catch {
    return undefined;
  }
}
