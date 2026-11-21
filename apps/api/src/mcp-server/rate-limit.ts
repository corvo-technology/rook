/** Calls one key may make in a window before it is told to slow down. */
export const MCP_CALLS_PER_WINDOW = 60;
export const MCP_WINDOW_MS = 60_000;

export interface McpRateLimiter {
  /** Counts one call for `key`; `retryAfterSeconds` says how long until the window opens again. */
  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number };
}

/**
 * A fixed window per key, held in memory. Each API process counts for itself, so the cap is
 * per process, which still bounds what one leaked key can do to any one of them.
 */
export function createMcpRateLimiter(
  options: { limit?: number; windowMs?: number; now?: () => number } = {},
): McpRateLimiter {
  const limit = options.limit ?? MCP_CALLS_PER_WINDOW;
  const windowMs = options.windowMs ?? MCP_WINDOW_MS;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    take(key) {
      const at = now();
      // Expired windows would otherwise accumulate one entry per key ever seen.
      if (windows.size > 1000) {
        for (const [id, window] of windows)
          if (at - window.startedAt >= windowMs) windows.delete(id);
      }
      const current = windows.get(key);
      if (!current || at - current.startedAt >= windowMs) {
        windows.set(key, { startedAt: at, count: 1 });
        return { ok: true };
      }
      if (current.count >= limit) {
        return {
          ok: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - at) / 1000)),
        };
      }
      current.count += 1;
      return { ok: true };
    },
  };
}
