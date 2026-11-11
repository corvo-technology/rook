import { canonicalPiProviderId } from "@corvo/contracts";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

type ModelCost = { input: number; output: number };

let catalogCosts: Map<string, ModelCost> | undefined;

function catalogCost(provider: string, id: string): ModelCost | undefined {
  if (!catalogCosts) {
    catalogCosts = new Map();
    for (const entry of builtinModels().getProviders()) {
      for (const model of entry.getModels()) {
        catalogCosts.set(`${entry.id}:${model.id}`, {
          input: model.cost.input,
          output: model.cost.output,
        });
      }
    }
  }
  return catalogCosts.get(`${canonicalPiProviderId(provider)}:${id}`);
}

/**
 * The model for background chores: the cheapest by catalog output price (ties by input price,
 * then list order) among the listed models the catalog prices. Null when the catalog cannot
 * tell which is cheaper, or when the cheapest is the main model. Names are never inspected.
 */
export function pickBackgroundModelId(input: {
  provider: string;
  models: readonly string[];
  mainModelId: string;
  costs?: (provider: string, id: string) => ModelCost | undefined;
}): string | null {
  const costs = input.costs ?? catalogCost;
  const priced: Array<{ id: string; cost: ModelCost }> = [];
  for (const id of input.models) {
    const cost = costs(input.provider, id);
    if (cost) priced.push({ id, cost });
  }
  if (priced.length < 2) return null;
  const first = priced[0];
  if (!first) return null;
  if (
    priced.every(({ cost }) => cost.output === first.cost.output && cost.input === first.cost.input)
  )
    return null;
  let best = first;
  for (const candidate of priced.slice(1)) {
    const { cost } = candidate;
    if (
      cost.output < best.cost.output ||
      (cost.output === best.cost.output && cost.input < best.cost.input)
    ) {
      best = candidate;
    }
  }
  return best.id === input.mainModelId ? null : best.id;
}
