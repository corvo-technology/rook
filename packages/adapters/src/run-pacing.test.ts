import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import { PACING_MAX_MS, PACING_MIN_MS, paceBotMessage, pacingDelayMs } from "./run-pacing.js";

function context(
  clock: { now: number },
  sleep = vi.fn(async (ms: number) => {
    clock.now += ms;
  }),
) {
  return {
    ctx: {
      deps: { pacing: { now: () => clock.now, sleep } },
      abortController: new AbortController(),
      state: { reply: {} },
    } as unknown as RunContext,
    sleep,
  };
}

describe("pacingDelayMs", () => {
  it("is proportional to length within human bounds", () => {
    expect(pacingDelayMs("ok")).toBe(PACING_MIN_MS);
    expect(pacingDelayMs("x".repeat(60))).toBe(1500);
    expect(pacingDelayMs("x".repeat(500))).toBe(PACING_MAX_MS);
  });
});

describe("paceBotMessage", () => {
  it("sends the first message at once and spaces the next ones", async () => {
    const clock = { now: 10_000 };
    const { ctx, sleep } = context(clock);
    await paceBotMessage(ctx, "Hey!");
    expect(sleep).not.toHaveBeenCalled();
    await paceBotMessage(ctx, "I looked at it.");
    expect(sleep).toHaveBeenCalledWith(PACING_MIN_MS, expect.anything());
    await paceBotMessage(ctx, "x".repeat(60));
    expect(sleep).toHaveBeenLastCalledWith(1500, expect.anything());
  });

  it("does not wait when enough time already passed", async () => {
    const clock = { now: 10_000 };
    const { ctx, sleep } = context(clock);
    await paceBotMessage(ctx, "One");
    clock.now += 60_000;
    await paceBotMessage(ctx, "Two");
    expect(sleep).not.toHaveBeenCalled();
  });
});
