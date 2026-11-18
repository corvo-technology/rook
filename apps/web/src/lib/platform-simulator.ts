import type { PartnerPricingConfig } from "@corvo/contracts";
import { useEffect, useState } from "react";

/** What the operator types about one typical customer for a month. */
export interface SimulatorForm {
  tier: string;
  customers: string;
  model: string;
  /** Millions of tokens. */
  inputM: string;
  outputM: string;
  voiceMinutes: string;
  computerMinutes: string;
  /** Percent of the model use that runs on the customer's own models. */
  ownShare: string;
}

export type SimulationRequest = {
  planPriceMinor: number;
  includedCredits: number;
  planPriceMicros?: number;
  customers: number;
  usage: {
    models: Array<{ model: string; inputTokens: number; outputTokens: number; own: boolean }>;
    voiceMinutes: number;
    computerMinutes: number;
    storageGb: number;
  };
  config?: PartnerPricingConfig;
};

const num = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * The calls the simulator makes, each the same typical customer: everything, then only models,
 * only voice and only computer, so every row of the breakdown is the server's own arithmetic.
 * Null while the form is not valid.
 */
export function simulationRequests(
  form: SimulatorForm,
  config: PartnerPricingConfig | null,
  draft: PartnerPricingConfig | null,
): Record<"total" | "models" | "voice" | "computer", SimulationRequest> | null {
  const live = draft ?? config;
  const tier = live?.tiers.find((item) => item.key === form.tier);
  const price = tier?.prices.USD ?? tier?.prices.BRL;
  const customers = num(form.customers);
  const inputM = num(form.inputM);
  const outputM = num(form.outputM);
  const voice = num(form.voiceMinutes);
  const computer = num(form.computerMinutes);
  const own = num(form.ownShare);
  if (!live || !tier || !price || !form.model) return null;
  if ([customers, inputM, outputM, voice, computer, own].some((value) => value === null)) {
    return null;
  }
  if (!customers || Math.round(customers) < 1 || (own as number) > 100) return null;
  const paidShare = 1 - (own as number) / 100;
  const base = {
    planPriceMinor: price.priceMinor,
    includedCredits: price.includedCredits,
    ...(tier.prices.USD ? { planPriceMicros: tier.prices.USD.priceMinor * 10_000 } : {}),
    customers: Math.round(customers),
    ...(draft ? { config: draft } : {}),
  };
  const models = [
    {
      model: form.model,
      inputTokens: Math.round((inputM as number) * 1_000_000 * paidShare),
      outputTokens: Math.round((outputM as number) * 1_000_000 * paidShare),
      own: false,
    },
  ];
  const usage = (parts: { models?: boolean; voice?: boolean; computer?: boolean }) => ({
    ...base,
    usage: {
      models: parts.models ? models : [],
      voiceMinutes: parts.voice ? (voice as number) : 0,
      computerMinutes: parts.computer ? (computer as number) : 0,
      storageGb: 0,
    },
  });
  return {
    total: usage({ models: true, voice: true, computer: true }),
    models: usage({ models: true }),
    voice: usage({ voice: true }),
    computer: usage({ computer: true }),
  };
}

/** A value that follows `value` once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
