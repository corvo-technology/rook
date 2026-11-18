import type { PartnerPricingConfig, PartnerSimulation } from "@corvo/contracts";
import { PartnerPricingConfigSchema } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";

/** One credit is one US cent of the fund: 10,000 micro-dollars. */
export const CREDIT_MICROS = 10_000n;
const BPS = 10_000n;

export class PartnerPricingError extends Error {
  constructor(readonly code: "unknown_model" | "no_pricing" | "overflow") {
    super(code);
    this.name = "PartnerPricingError";
  }
}

export interface UsageMix {
  models: Array<{ model: string; inputTokens: number; outputTokens: number; own?: boolean }>;
  voiceMinutes: number;
  computerMinutes: number;
  storageGb: number;
}

export interface SimulationInput {
  planPriceMinor: number;
  includedCredits: number;
  customers: number;
  usage: UsageMix;
  planPriceMicros?: number;
}

/** `value x rate` where the rate is a decimal, in micro-units, rounded down. */
const scaled = (units: number, perUnitMicros: number) =>
  (BigInt(Math.floor(units * 1_000_000)) * BigInt(perUnitMicros)) / 1_000_000n;

const withMargin = (cost: bigint, bps: number) => (cost * (BPS + BigInt(bps))) / BPS;

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new PartnerPricingError("overflow");
  return Number(value);
}

/**
 * What a plan can carry: from what one typical customer uses and the platform's cost and margin
 * numbers, the credits a customer burns in a month, the split of Rook's cost between models and
 * infrastructure, Rook's margin, and how many such customers the plan's credits cover. Pure,
 * deterministic and in integers: every figure rounds down except credits, which round up so a
 * customer is never under-counted.
 */
export function simulatePartnerPricing(
  config: PartnerPricingConfig,
  input: SimulationInput,
): PartnerSimulation {
  let modelsCost = 0n;
  let modelsCharged = 0n;
  for (const use of input.usage.models) {
    // A customer's own models are never debited, and are not priced at all.
    if (use.own) continue;
    const cost = config.costs.models[use.model];
    if (!cost) throw new PartnerPricingError("unknown_model");
    const base =
      (BigInt(use.inputTokens) * BigInt(cost.inputPer1MMicros) +
        BigInt(use.outputTokens) * BigInt(cost.outputPer1MMicros)) /
      1_000_000n;
    modelsCost += base;
    modelsCharged += withMargin(
      base,
      config.margins.perModelBps[use.model] ?? config.margins.tokensBps,
    );
  }
  const voice = scaled(input.usage.voiceMinutes, config.costs.voiceMinuteMicros);
  const computer = scaled(input.usage.computerMinutes, config.costs.computerMinuteMicros);
  const billableGb = Math.max(0, input.usage.storageGb - config.storageAllowanceGb);
  const storage = scaled(billableGb, config.costs.storageGbMonthMicros);
  const infraCost = voice + computer + storage;
  const infraCharged =
    withMargin(voice, config.margins.voiceBps) +
    withMargin(computer, config.margins.computerMinuteBps) +
    withMargin(storage, config.margins.storageBps);

  const cost = modelsCost + infraCost;
  const charged = modelsCharged + infraCharged;
  const creditsPerCustomer = (charged + CREDIT_MICROS - 1n) / CREDIT_MICROS;
  const marginPerCustomer = charged - cost;
  const customers = BigInt(input.customers);
  const needed = creditsPerCustomer * customers;
  const included = BigInt(input.includedCredits);
  const shortfall = needed > included ? needed - included : 0n;
  return {
    creditsPerCustomer: safe(creditsPerCustomer),
    costPerCustomer: { modelsMicros: safe(modelsCost), infraMicros: safe(infraCost) },
    marginPerCustomerMicros: safe(marginPerCustomer),
    customersSupported: creditsPerCustomer === 0n ? null : safe(included / creditsPerCustomer),
    fund: {
      creditsNeeded: safe(needed),
      covered: shortfall === 0n,
      shortfallCredits: safe(shortfall),
    },
    totalMarginMicros: safe(marginPerCustomer * customers),
    planMarginMicros:
      input.planPriceMicros === undefined
        ? null
        : Number(BigInt(input.planPriceMicros) - cost * customers),
  };
}

/** The live pricing: the highest version, or null before an admin has written one. */
export async function livePartnerPricing(
  prisma: PrismaClient,
): Promise<{ version: number; config: PartnerPricingConfig; createdAt: Date } | null> {
  const row = await prisma.partnerPricingVersion.findFirst({ orderBy: { version: "desc" } });
  if (!row) return null;
  const parsed = PartnerPricingConfigSchema.safeParse(row.config);
  return parsed.success
    ? { version: row.version, config: parsed.data, createdAt: row.createdAt }
    : null;
}

/** Writes the next version; earlier ones stay as the record of what was live. */
export async function publishPartnerPricing(
  prisma: PrismaClient,
  config: PartnerPricingConfig,
  createdByUserId: string | null,
): Promise<{ version: number }> {
  const valid = PartnerPricingConfigSchema.parse(config);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = await prisma.partnerPricingVersion.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    try {
      await prisma.partnerPricingVersion.create({
        data: { version, config: valid as never, createdByUserId },
      });
      return { version };
    } catch (error) {
      if ((error as { code?: unknown })?.code !== "P2002") throw error;
    }
  }
  throw new Error("Could not publish the pricing");
}
