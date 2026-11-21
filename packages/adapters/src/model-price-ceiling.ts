import type { ModelPriceCeiling } from "@corvo/adapter-kit";
import { builtinDefaultModel } from "./deployment-model.js";
import { catalogModelCost, cheapestCatalogModelId } from "./pi-runtime-models.js";

/** A flat cap for one call to a model with no price to size a hold by, when nothing else bounds it. */
export function configuredCallCeilingUsd(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const value = Number(env.PI_MODEL_CALL_CEILING_USD);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * What one call to a variable-priced model may cost at most: the highest rate of any model it can
 * route to, else the configured cap per call. Undefined leaves the hold refused for lack of a
 * reliable price, which is safe; a guess never is.
 */
export function priceCeilingFor(
  candidates: ReadonlyArray<{ provider: string; modelId: string }>,
  env: NodeJS.ProcessEnv = process.env,
): ModelPriceCeiling | undefined {
  const costs = candidates.flatMap((candidate) => {
    const cost = catalogModelCost(candidate.provider, candidate.modelId);
    if (!cost) return [];
    const tiers = [cost, ...(cost.tiers ?? [])];
    return [
      {
        input: Math.max(...tiers.map((tier) => tier.input)),
        output: Math.max(...tiers.map((tier) => tier.output)),
        cacheRead: Math.max(...tiers.map((tier) => tier.cacheRead)),
        cacheWrite: Math.max(...tiers.map((tier) => tier.cacheWrite)),
      },
    ];
  });
  if (costs.length > 0) {
    const highest = (key: "input" | "output" | "cacheRead" | "cacheWrite") =>
      Math.max(...costs.map((cost) => cost[key]));
    return {
      perMillionUsd: {
        input: highest("input"),
        output: highest("output"),
        cacheRead: highest("cacheRead"),
        cacheWrite: highest("cacheWrite"),
      },
    };
  }
  const callUsd = configuredCallCeilingUsd(env);
  return callUsd ? { callUsd } : undefined;
}

/**
 * The first of the deployment's own models, on the provider a funded call already runs on, that
 * the catalog can price. A customer on platform credits whose chosen model has no reliable price
 * runs on it instead of failing the hold.
 */
export function pricedModelOnProvider(
  provider: string,
  candidates: ReadonlyArray<{ provider: string; modelId: string } | null | undefined>,
): string | undefined {
  return candidates.find(
    (choice) =>
      choice && choice.provider === provider && catalogModelCost(choice.provider, choice.modelId),
  )?.modelId;
}

/**
 * The priced model a funded call runs on when its own has no price: the deployment's models first,
 * then the platform's built-in default for the provider, then the cheapest the catalog prices. A
 * deployment whose own default is newer than the catalog prices none of its models, so the first
 * step alone would leave the call refused.
 */
export function pricedFallbackModel(
  provider: string,
  deploymentModels: ReadonlyArray<{ provider: string; modelId: string } | null | undefined>,
): string | undefined {
  const builtin = builtinDefaultModel(provider);
  return (
    pricedModelOnProvider(provider, [
      ...deploymentModels,
      builtin ? { provider, modelId: builtin } : null,
    ]) ?? cheapestCatalogModelId(provider)
  );
}
