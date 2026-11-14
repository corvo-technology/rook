import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  drain,
  drainTimeoutFromEnv,
  INTERRUPT_GRACE_MS,
  requiredTerminationGraceMs,
} from "./drain.js";

afterEach(() => vi.useRealTimers());

function runInFlight() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { done, finish };
}

describe("worker drain", () => {
  it("waits for an in-flight run and finishes without interrupting it", async () => {
    vi.useFakeTimers();
    const run = runInFlight();
    const interrupt = vi.fn();
    const outcome = drain({ stop: () => run.done, interrupt, timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    run.finish();
    await expect(outcome).resolves.toBe("drained");
    expect(interrupt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("interrupts at the deadline and lets runs hand themselves back", async () => {
    vi.useFakeTimers();
    const run = runInFlight();
    const interrupt = vi.fn(() => run.finish());
    const outcome = drain({ stop: () => run.done, interrupt, timeoutMs: 120_000 });
    await vi.advanceTimersByTimeAsync(119_999);
    expect(interrupt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe("interrupted");
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("gives up after the grace period so the process can exit", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const outcome = drain({
      stop: () => new Promise<void>(() => undefined),
      interrupt: vi.fn(),
      timeoutMs: 1_000,
      log,
    });
    await vi.advanceTimersByTimeAsync(1_000 + INTERRUPT_GRACE_MS);
    await expect(outcome).resolves.toBe("abandoned");
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("reports a failing stop to the caller without an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await expect(
        drain({
          stop: () => Promise.reject(new Error("stop failed")),
          interrupt: vi.fn(),
          timeoutMs: 1_000,
        }),
      ).rejects.toThrow("stop failed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("defaults to two minutes and keeps the pod grace period above the drain", () => {
    expect(DEFAULT_DRAIN_TIMEOUT_MS).toBe(120_000);
    expect(drainTimeoutFromEnv({})).toBe(120_000);
    expect(drainTimeoutFromEnv({ WORKER_DRAIN_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(drainTimeoutFromEnv({ WORKER_DRAIN_TIMEOUT_MS: "soon" })).toBe(120_000);
    expect(requiredTerminationGraceMs(120_000)).toBe(150_000);
  });
});
