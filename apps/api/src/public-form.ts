import type { Context } from "hono";

const MAX_TRACKED_KEYS = 10_000;

/** Fixed-window counters per key. The table is bounded: when full it starts over. */
export function windowCounter(windowMs: number, now: () => number) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string): number => {
    const at = now();
    const current = windows.get(key);
    if (current && at - current.start < windowMs) return ++current.count;
    if (windows.size >= MAX_TRACKED_KEYS) windows.clear();
    windows.set(key, { start: at, count: 1 });
    return 1;
  };
}

/** CORS for the public forms the marketing site posts: only the allowed origins, never a wildcard. */
export function formCors(allowedOrigins: readonly string[]) {
  const allowOrigin = (c: Context): string | undefined => {
    const origin = c.req.header("origin");
    return origin && allowedOrigins.includes(origin) ? origin : undefined;
  };
  const reply = (c: Context, status: 200 | 400 | 403 | 413 | 415 | 429, payload: object) => {
    const origin = allowOrigin(c);
    if (origin) c.header("access-control-allow-origin", origin);
    c.header("vary", "Origin");
    c.header("cache-control", "no-store");
    return c.json(payload, status);
  };
  const preflight = (c: Context) => {
    const origin = allowOrigin(c);
    if (!origin) return c.body(null, 403);
    return c.body(null, 204, {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    });
  };
  return { allowOrigin, reply, preflight };
}
