import type { PrismaClient } from "@corvo/db";
import { createLogger, createTestSink, installLogger } from "@corvo/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelCreditReconciler, estimateHeldCallCost } from "./model-credit-reconciler.js";

const catalogCost = vi.hoisted(() => vi.fn(() => undefined as unknown));
vi.mock("./pi-runtime-models.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./pi-runtime-models.js")>()),
  catalogModelCost: catalogCost,
}));
const recordUsage = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  recordUsage,
}));

function harness(call: Record<string, unknown>) {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    modelCreditLot: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    modelCreditEntry: { findMany: vi.fn().mockResolvedValue([call]), updateMany },
    modelCreditAccount: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  return { prisma, updateMany };
}

const baseCall = {
  id: "entry-1",
  callId: "call-1",
  userId: "user-1",
  spaceId: "space-1",
  runId: "run-1",
  provider: "fake",
  model: "fake-model",
  pending: true,
  amountMicros: -2_000_000n,
  usage: null,
  providerRequestId: null,
  auditRevision: 0,
};

describe("model credit reconciler", () => {
  afterEach(() => {
    recordUsage.mockClear();
    installLogger(createLogger({ service: "corvo-worker", level: "off", sinks: [] }));
  });

  it("settles an unpriced hold at zero and leaves it flagged for review", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "corvo-worker", sinks: [sink] }));
    const { prisma, updateMany } = harness({ ...baseCall, reconciliationAttempts: 5 });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(recordUsage).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ costUsd: 0, costSource: "reconciliation-unpriced" }),
      expect.objectContaining({ runId: "run-1" }),
      true,
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "entry-1", reconciliationState: "pending" },
      data: { reconciliationState: "needs_review", nextReconcileAt: null },
    });
    expect(sink.events).toContainEqual(
      expect.objectContaining({
        level: "error",
        message: "Model credit hold requires review",
        callId: "call-1",
        reason: "no catalog price; settled at zero",
      }),
    );
  });

  it("settles a hold with a catalog price at the estimate and completes it", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "corvo-worker", sinks: [sink] }));
    catalogCost.mockReturnValueOnce({ input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 });
    const { prisma, updateMany } = harness({
      ...baseCall,
      reconciliationAttempts: 5,
      usage: { inputTokens: 1_000_000, outputTokens: 500_000, costUsd: null },
    });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(recordUsage).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ costUsd: 2, costSource: "reconciliation-estimate" }),
      expect.objectContaining({ runId: "run-1" }),
      true,
    );
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "entry-1", reconciliationState: "pending" },
      data: { reconciliationState: "complete", nextReconcileAt: null },
    });
    expect(sink.events).toContainEqual(
      expect.objectContaining({ message: "Model credit hold settled at an estimate" }),
    );
  });

  it("flags a hold for review when even the estimate cannot be recorded", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "corvo-worker", sinks: [sink] }));
    recordUsage.mockRejectedValueOnce(new Error("database down"));
    const { prisma, updateMany } = harness({ ...baseCall, reconciliationAttempts: 5 });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: "entry-1", reconciliationState: "pending" },
      data: { reconciliationState: "needs_review", nextReconcileAt: null },
    });
    expect(sink.events).toContainEqual(
      expect.objectContaining({
        message: "Model credit hold requires review",
        reason: "database down",
      }),
    );
  });

  it("keeps the failure reason on each attempt that could not verify a call", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "corvo-worker", sinks: [sink] }));
    const { prisma } = harness({ ...baseCall, model: null, reconciliationAttempts: 0 });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(sink.events).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Model credit reconciliation could not verify a call",
        reason: "Legacy reservation requires manual attribution",
      }),
    ]);
  });

  it("settles a hold with unknown tokens at zero, never at the amount held", async () => {
    const { prisma } = harness({
      ...baseCall,
      reconciliationAttempts: 5,
      usage: { inputTokens: 10, outputTokens: 10, costUsd: null },
    });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ callId: "call-1", costUsd: 0 }),
      expect.objectContaining({ runId: "run-1" }),
      true,
    );
  });

  it("keeps retrying before the attempts run out", async () => {
    const { prisma } = harness({ ...baseCall, reconciliationAttempts: 2 });

    await createModelCreditReconciler({ prisma, now: () => new Date(0) })();

    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("prices the tokens at the catalog rate when that is below the hold", () => {
    catalogCost.mockReturnValueOnce({ input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 });
    const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };
    expect(estimateHeldCallCost(10, usage, "fake", "fake-model")).toBe(2);
    catalogCost.mockReturnValueOnce({ input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1 });
    expect(estimateHeldCallCost(1, usage, "fake", "fake-model")).toBe(1);
  });

  it("never estimates above the hold, and does not guess without a price or tokens", () => {
    catalogCost.mockReturnValueOnce({ input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 });
    expect(
      estimateHeldCallCost(0.5, { inputTokens: 1_000_000, outputTokens: 1 }, "fake", "fake-model"),
    ).toBe(0.5);
    expect(estimateHeldCallCost(0.5, null, "fake", "fake-model")).toBeUndefined();
    catalogCost.mockReturnValueOnce({ input: 1, output: 2, cacheRead: 0, cacheWrite: 0 });
    expect(
      estimateHeldCallCost(0.5, { inputTokens: null, outputTokens: 5 }, "fake", "fake-model"),
    ).toBeUndefined();
  });
});
