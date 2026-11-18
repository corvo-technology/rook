import type { PartnerPricingConfig } from "@corvo/contracts";
import { PartnerPricingConfigSchema } from "@corvo/contracts";

/**
 * The pricing screen edits text, so a half-typed number is never lost; this turns what is typed
 * into a config and back. Money in the config is micro-dollars, margins are basis points.
 */

const CURRENCIES = ["BRL", "USD"] as const;
export type PricingCurrency = (typeof CURRENCIES)[number];
export const PRICING_CURRENCIES = CURRENCIES;

export interface TierForm {
  key: string;
  name: string;
  /** Per currency, in whole currency units and credits; blank means the currency is not offered. */
  prices: Record<PricingCurrency, { price: string; credits: string }>;
}

export interface ModelForm {
  model: string;
  inputCost: string;
  outputCost: string;
  margin: string;
}

export interface PricingForm {
  tiers: TierForm[];
  models: ModelForm[];
  modelMargin: string;
  voiceCost: string;
  voiceMargin: string;
  computerCost: string;
  computerMargin: string;
  storageCost: string;
  storageMargin: string;
  storageAllowanceGb: string;
  topupMarkup: string;
  topupExpiryDays: string;
  lowBalance: string;
}

const text = (value: number) => String(Math.round(value * 1_000_000) / 1_000_000);
const dollars = (micros: number) => text(micros / 1_000_000);
const percent = (bps: number) => text(bps / 100);

export function formFromConfig(config: PartnerPricingConfig | null): PricingForm {
  if (!config) {
    return {
      tiers: [],
      models: [],
      modelMargin: "0",
      voiceCost: "0",
      voiceMargin: "0",
      computerCost: "0",
      computerMargin: "0",
      storageCost: "0",
      storageMargin: "0",
      storageAllowanceGb: "0",
      topupMarkup: "1",
      topupExpiryDays: "",
      lowBalance: "20",
    };
  }
  return {
    tiers: config.tiers.map((tier) => ({
      key: tier.key,
      name: tier.name,
      prices: {
        BRL: priceForm(tier.prices.BRL),
        USD: priceForm(tier.prices.USD),
      },
    })),
    models: Object.entries(config.costs.models).map(([model, cost]) => ({
      model,
      inputCost: dollars(cost.inputPer1MMicros),
      outputCost: dollars(cost.outputPer1MMicros),
      margin: percent(config.margins.perModelBps[model] ?? config.margins.tokensBps),
    })),
    modelMargin: percent(config.margins.tokensBps),
    voiceCost: dollars(config.costs.voiceMinuteMicros),
    voiceMargin: percent(config.margins.voiceBps),
    computerCost: dollars(config.costs.computerMinuteMicros),
    computerMargin: percent(config.margins.computerMinuteBps),
    storageCost: dollars(config.costs.storageGbMonthMicros),
    storageMargin: percent(config.margins.storageBps),
    storageAllowanceGb: text(config.storageAllowanceGb),
    topupMarkup: percent(config.topupMarkupBps),
    topupExpiryDays: config.topupExpiryDays === null ? "" : String(config.topupExpiryDays),
    lowBalance: percent(config.lowBalanceBps),
  };
}

function priceForm(entry: { priceMinor: number; includedCredits: number } | undefined) {
  return entry
    ? { price: text(entry.priceMinor / 100), credits: String(entry.includedCredits) }
    : { price: "", credits: "" };
}

const number = (value: string) =>
  value.trim() === "" ? Number.NaN : Number(value.replace(",", "."));
const micros = (value: string) => Math.round(number(value) * 1_000_000);
const bps = (value: string) => Math.round(number(value) * 100);

/** A tier's key from its name, unique among the keys already taken. */
export function tierKey(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "plan";
  let key = base;
  for (let n = 2; taken.includes(key); n += 1) key = `${base}-${n}`;
  return key;
}

/** The config the form describes, or null while something typed is not a valid number. */
export function configFromForm(form: PricingForm): PartnerPricingConfig | null {
  const tiers: unknown[] = [];
  for (const tier of form.tiers) {
    const prices: Partial<
      Record<PricingCurrency, { priceMinor: number; includedCredits: number }>
    > = {};
    for (const currency of PRICING_CURRENCIES) {
      const entry = tier.prices[currency];
      if (entry.price.trim() === "" && entry.credits.trim() === "") continue;
      prices[currency] = {
        priceMinor: Math.round(number(entry.price) * 100),
        includedCredits: Math.round(number(entry.credits)),
      };
    }
    tiers.push({ key: tier.key, name: tier.name.trim(), prices });
  }
  const tokensBps = bps(form.modelMargin);
  const parsed = PartnerPricingConfigSchema.safeParse({
    tiers,
    costs: {
      models: Object.fromEntries(
        form.models.map((model) => [
          model.model.trim(),
          {
            inputPer1MMicros: micros(model.inputCost),
            outputPer1MMicros: micros(model.outputCost),
          },
        ]),
      ),
      voiceMinuteMicros: micros(form.voiceCost),
      computerMinuteMicros: micros(form.computerCost),
      storageGbMonthMicros: micros(form.storageCost),
    },
    margins: {
      tokensBps,
      perModelBps: Object.fromEntries(
        form.models
          .filter((model) => bps(model.margin) !== tokensBps)
          .map((model) => [model.model.trim(), bps(model.margin)]),
      ),
      voiceBps: bps(form.voiceMargin),
      computerMinuteBps: bps(form.computerMargin),
      storageBps: bps(form.storageMargin),
    },
    storageAllowanceGb: number(form.storageAllowanceGb),
    topupMarkupBps: bps(form.topupMarkup),
    topupExpiryDays: form.topupExpiryDays.trim() === "" ? null : number(form.topupExpiryDays),
    lowBalanceBps: bps(form.lowBalance),
  });
  return parsed.success ? parsed.data : null;
}

/** Credits one unit of a resource debits: cost with the margin on top, a credit being a US cent. */
export function debitCredits(costUsd: string, marginPercent: string): number | null {
  const cost = number(costUsd);
  const margin = number(marginPercent);
  if (!Number.isFinite(cost) || !Number.isFinite(margin)) return null;
  return cost * (1 + margin / 100) * 100;
}

/** Whether two configs say the same, whatever the key order. */
export function sameConfig(a: PartnerPricingConfig | null, b: PartnerPricingConfig | null) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([key, inner]) => [key, sorted(inner)]),
    );
  }
  return value;
}
