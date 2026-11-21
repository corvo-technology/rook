import { describe, expect, it } from "vitest";
import { createMcpRateLimiter } from "./rate-limit.js";

describe("MCP rate limit", () => {
  it("lets a key call up to the limit and then says when to try again", () => {
    let now = 0;
    const limiter = createMcpRateLimiter({ limit: 3, windowMs: 10_000, now: () => now });
    for (let call = 0; call < 3; call++) expect(limiter.take("key-1")).toEqual({ ok: true });
    now = 4_000;
    expect(limiter.take("key-1")).toEqual({ ok: false, retryAfterSeconds: 6 });
  });

  it("opens a new window after the old one ends", () => {
    let now = 0;
    const limiter = createMcpRateLimiter({ limit: 1, windowMs: 1_000, now: () => now });
    expect(limiter.take("key-1").ok).toBe(true);
    expect(limiter.take("key-1").ok).toBe(false);
    now = 1_000;
    expect(limiter.take("key-1").ok).toBe(true);
  });

  it("counts each key on its own", () => {
    const limiter = createMcpRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.take("key-1").ok).toBe(true);
    expect(limiter.take("key-2").ok).toBe(true);
    expect(limiter.take("key-1").ok).toBe(false);
  });
});
