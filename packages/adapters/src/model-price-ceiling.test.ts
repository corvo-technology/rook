import { describe, expect, it } from "vitest";
import { priceCeilingFor } from "./model-price-ceiling.js";
import { resolveRuntimeModel } from "./pi-runtime-models.js";
import { maximumModelCallCost } from "./pi-usage.js";

// Per-million prices of two catalog models, read from the catalog itself so the test follows it.
const cheap = { provider: "openrouter", modelId: "deepseek/deepseek-v3.2" };
const pricey = { provider: "openrouter", modelId: "anthropic/claude-sonnet-4.6" };

function ceilingOf(candidates: Array<{ provider: string; modelId: string }>, env = {}) {
  return priceCeilingFor(candidates, env);
}

describe("price ceiling for variable-priced models", () => {
  it("is the highest rate of any candidate tier model", () => {
    const both = ceilingOf([cheap, pricey]);
    const onlyCheap = ceilingOf([cheap]);
    expect(both && "perMillionUsd" in both).toBe(true);
    if (!both || !("perMillionUsd" in both) || !onlyCheap || !("perMillionUsd" in onlyCheap))
      throw new Error("expected rates");
    expect(both.perMillionUsd.output).toBeGreaterThan(onlyCheap.perMillionUsd.output);
    expect(both.perMillionUsd.input).toBeGreaterThanOrEqual(onlyCheap.perMillionUsd.input);
  });

  it("falls back to the configured cap per call, and to nothing without one", () => {
    expect(ceilingOf([], { PI_MODEL_CALL_CEILING_USD: "1.5" })).toEqual({ callUsd: 1.5 });
    expect(ceilingOf([], {})).toBeUndefined();
    expect(ceilingOf([], { PI_MODEL_CALL_CEILING_USD: "-3" })).toBeUndefined();
    expect(
      ceilingOf([{ provider: "openrouter", modelId: "typesafe/jev-router" }], {}),
    ).toBeUndefined();
  });
});

describe("a router priced -1 never under-reserves", () => {
  const router = { provider: "openrouter", id: "typesafe/jev-router", contextWindow: 200_000 };

  it("has no hold at all when no ceiling is given, so the call is refused rather than guessed", () => {
    const { model } = resolveRuntimeModel({ ...router, apiKey: "k" });
    expect(model && maximumModelCallCost(model.cost, 10_000, 4_000)).toSatisfy(
      (cost: number | undefined) => cost === undefined || cost <= 0 || !Number.isFinite(cost),
    );
  });

  it("sizes the hold by the most expensive candidate when its own price is -1", () => {
    const ceiling = ceilingOf([cheap, pricey]);
    const { model } = resolveRuntimeModel({ ...router, apiKey: "k", priceCeiling: ceiling });
    const hold = model && maximumModelCallCost(model.cost, 10_000, 4_000);
    const strongOnly = resolveRuntimeModel({
      provider: pricey.provider,
      id: pricey.modelId,
      apiKey: "k",
    }).model;
    const strongHold = strongOnly && maximumModelCallCost(strongOnly.cost, 10_000, 4_000);
    expect(hold).toBeGreaterThan(0);
    // Never less than the strongest candidate would have held on its own.
    expect(hold).toBeGreaterThanOrEqual(strongHold ?? Number.POSITIVE_INFINITY);
  });

  it("caps a call at the configured amount, at any size of request", () => {
    const { model } = resolveRuntimeModel({
      ...router,
      apiKey: "k",
      priceCeiling: { callUsd: 2 },
    });
    const full = model && maximumModelCallCost(model.cost, 200_000, model.maxTokens);
    expect(full).toBeGreaterThan(0);
    expect(full).toBeLessThanOrEqual(2.000001);
    expect(model && maximumModelCallCost(model.cost, 1_000, 500)).toBeLessThan(2);
  });

  it("leaves a model with a reliable price on its own price", () => {
    const withCeiling = resolveRuntimeModel({
      provider: pricey.provider,
      id: pricey.modelId,
      apiKey: "k",
      priceCeiling: { callUsd: 0.0001 },
    }).model;
    const without = resolveRuntimeModel({
      provider: pricey.provider,
      id: pricey.modelId,
      apiKey: "k",
    }).model;
    expect(withCeiling?.cost).toEqual(without?.cost);
  });
});
