import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_COOLDOWN_MS,
  ModelCooldowns,
  retryAfterFromHeaders,
} from "./model-cooldown.js";

describe("ModelCooldowns", () => {
  it("cools a model for the Retry-After, then lets it back", () => {
    let now = 0;
    const cooldowns = new ModelCooldowns(() => now);
    cooldowns.start("m", 12_000);
    expect(cooldowns.remainingMs("m")).toBe(12_000);
    now = 11_999;
    expect(cooldowns.remainingMs("m")).toBe(1);
    now = 12_000;
    expect(cooldowns.remainingMs("m")).toBe(0);
  });

  it("uses a default wait when the provider gave none, and bounds a huge one", () => {
    const cooldowns = new ModelCooldowns(() => 0);
    cooldowns.start("a");
    cooldowns.start("b", 24 * 60 * 60_000);
    expect(cooldowns.remainingMs("a")).toBe(DEFAULT_MODEL_COOLDOWN_MS);
    expect(cooldowns.remainingMs("b")).toBe(5 * 60_000);
  });

  it("forgets a cooldown once the model answers", () => {
    const cooldowns = new ModelCooldowns(() => 0);
    cooldowns.start("m", 5_000);
    cooldowns.clear("m");
    expect(cooldowns.remainingMs("m")).toBe(0);
  });
});

describe("retryAfterFromHeaders", () => {
  it("reads seconds under any header casing", () => {
    expect(retryAfterFromHeaders({ "Retry-After": "7" })).toBe(7_000);
    expect(retryAfterFromHeaders({ "retry-after": "0" })).toBe(0);
  });

  it("reads an HTTP date and ignores nonsense", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(retryAfterFromHeaders({ "retry-after": "Thu, 01 Jan 2026 00:00:30 GMT" }, now)).toBe(
      30_000,
    );
    expect(retryAfterFromHeaders({ "retry-after": "soon" }, now)).toBeUndefined();
    expect(retryAfterFromHeaders({}, now)).toBeUndefined();
    expect(retryAfterFromHeaders(undefined, now)).toBeUndefined();
  });
});
