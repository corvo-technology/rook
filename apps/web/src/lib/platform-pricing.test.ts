import type { PartnerPricingConfig } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import {
  configFromForm,
  debitCredits,
  formFromConfig,
  sameConfig,
  tierKey,
} from "./platform-pricing";
import { simulationRequests } from "./platform-simulator";

const config: PartnerPricingConfig = {
  tiers: [
    {
      key: "pro",
      name: "Pro",
      prices: {
        BRL: { priceMinor: 250_000, includedCredits: 50_000 },
        USD: { priceMinor: 50_000, includedCredits: 50_000 },
      },
    },
  ],
  costs: {
    models: { sonnet: { inputPer1MMicros: 3_000_000, outputPer1MMicros: 15_000_000 } },
    voiceMinuteMicros: 90_000,
    computerMinuteMicros: 10_000,
    storageGbMonthMicros: 20_000,
  },
  margins: {
    tokensBps: 2000,
    perModelBps: { sonnet: 3500 },
    voiceBps: 3000,
    computerMinuteBps: 3000,
    storageBps: 3000,
  },
  storageAllowanceGb: 5,
  topupMarkupBps: 100,
  topupExpiryDays: 90,
  lowBalanceBps: 2000,
};

describe("the pricing form", () => {
  it("round-trips a config without changing it", () => {
    expect(sameConfig(configFromForm(formFromConfig(config)), config)).toBe(true);
  });

  it("starts an empty pricing with the 1% top-up markup", () => {
    const form = formFromConfig(null);
    expect(form.topupMarkup).toBe("1");
    expect(configFromForm(form)?.topupMarkupBps).toBe(100);
  });

  it("keeps a per-model margin only where it differs from the default", () => {
    const form = formFromConfig(config);
    form.models = form.models.map((model) => ({ ...model, margin: "20" }));
    expect(configFromForm(form)?.margins.perModelBps).toEqual({});
  });

  it("needs a price in every currency and refuses a number that is not one", () => {
    const form = formFromConfig(config);
    form.tiers = form.tiers.map((tier) => ({
      ...tier,
      prices: { ...tier.prices, USD: { price: "", credits: "" } },
    }));
    expect(configFromForm(form)).toBeNull();
    const other = formFromConfig(config);
    other.voiceCost = "abc";
    expect(configFromForm(other)).toBeNull();
  });

  it("reads a decimal comma and an empty expiry as never", () => {
    const form = formFromConfig(config);
    form.voiceCost = "0,09";
    form.topupExpiryDays = "";
    const next = configFromForm(form);
    expect(next?.costs.voiceMinuteMicros).toBe(90_000);
    expect(next?.topupExpiryDays).toBeNull();
  });

  it("tells credits from cost and margin, a credit being a US cent", () => {
    expect(debitCredits("0.09", "30")).toBeCloseTo(11.7);
    expect(debitCredits("x", "30")).toBeNull();
  });

  it("makes a unique key from a plan name", () => {
    expect(tierKey("Parceiro Pró", [])).toBe("parceiro-pro");
    expect(tierKey("Pro", ["pro", "pro-2"])).toBe("pro-3");
  });
});

describe("the simulator requests", () => {
  const form = {
    tier: "pro",
    customers: "10",
    model: "sonnet",
    inputM: "1",
    outputM: "0.5",
    voiceMinutes: "60",
    computerMinutes: "120",
    ownShare: "25",
  };

  it("asks for the whole customer and for each part alone", () => {
    const requests = simulationRequests(form, config, null);
    expect(requests?.total.customers).toBe(10);
    expect(requests?.total.includedCredits).toBe(50_000);
    expect(requests?.total.usage).toMatchObject({ voiceMinutes: 60, computerMinutes: 120 });
    expect(requests?.models.usage).toMatchObject({ voiceMinutes: 0, computerMinutes: 0 });
    expect(requests?.voice.usage.models).toEqual([]);
    expect(requests?.computer.usage).toMatchObject({ voiceMinutes: 0, computerMinutes: 120 });
  });

  it("leaves the share on the customer's own models out of the paid tokens", () => {
    const models = simulationRequests(form, config, null)?.total.usage.models;
    expect(models).toEqual([
      { model: "sonnet", inputTokens: 750_000, outputTokens: 375_000, own: false },
    ]);
  });

  it("tries a draft when there is one, and waits while the form is not valid", () => {
    expect(simulationRequests(form, config, config)?.total.config).toEqual(config);
    expect(simulationRequests(form, config, null)?.total.config).toBeUndefined();
    expect(simulationRequests({ ...form, customers: "0" }, config, null)).toBeNull();
    expect(simulationRequests({ ...form, ownShare: "120" }, config, null)).toBeNull();
    expect(simulationRequests({ ...form, voiceMinutes: "x" }, config, null)).toBeNull();
  });
});
