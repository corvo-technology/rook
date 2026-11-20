import * as z from "zod";
import type { BillingCurrency, BillingInterval } from "./plan-pricing.js";

/** Provider-neutral computer sizes; each sandbox adapter maps a size to its own mechanism. */
export const COMPUTER_SIZES = ["small", "medium", "large"] as const;
export const ComputerSizeSchema = z.enum(COMPUTER_SIZES);
export type ComputerSize = z.infer<typeof ComputerSizeSchema>;

/** What each size means, for display. Adapters decide how to deliver it. */
export const COMPUTER_SIZE_SPECS: Record<
  ComputerSize,
  { cpu: number; memoryGb: number; diskGb: number }
> = {
  small: { cpu: 2, memoryGb: 4, diskGb: 10 },
  medium: { cpu: 4, memoryGb: 8, diskGb: 20 },
  large: { cpu: 8, memoryGb: 16, diskGb: 40 },
};

export const PLAN_IDS = ["personal", "team", "company"] as const;
export const PlanIdSchema = z.enum(PLAN_IDS);
export type PlanId = z.infer<typeof PlanIdSchema>;

export const GIB = 1024 ** 3;

export const PlanEntitlementsSchema = z.object({
  plan: PlanIdSchema,
  computerSize: ComputerSizeSchema,
  /** How many computers the organization may have. */
  computers: z.number().int().positive(),
  /** File storage across drive files, attachments and computer homes. */
  storageBytes: z.number().int().positive(),
  /** People included in the price; the organization's members plus pending invites. */
  seatsIncluded: z.number().int().positive(),
  /** The most people the plan allows, extra seats included. */
  maxSeats: z.number().int().positive(),
  /** Billing price of one extra seat above the included ones; absent means extra seats are free. */
  extraSeatPriceId: z.string().min(1).optional(),
});
export type PlanEntitlements = z.infer<typeof PlanEntitlementsSchema>;

/** The default table. A deployment edits it with `PLAN_LIMITS`. */
export const DEFAULT_PLANS: Record<PlanId, PlanEntitlements> = {
  personal: {
    plan: "personal",
    computerSize: "small",
    computers: 1,
    storageBytes: 25 * GIB,
    seatsIncluded: 1,
    maxSeats: 1,
  },
  team: {
    plan: "team",
    computerSize: "medium",
    computers: 1,
    storageBytes: 50 * GIB,
    seatsIncluded: 10,
    maxSeats: 15,
  },
  company: {
    plan: "company",
    computerSize: "large",
    computers: 1,
    storageBytes: 200 * GIB,
    seatsIncluded: 25,
    maxSeats: 50,
  },
};

/** The plan an organization has before it subscribes or while it is on trial. */
export const FALLBACK_PLAN: PlanId = "personal";

/** Plans are on only where the deployment maps billing prices to them (the cloud). */
export interface PlanConfig {
  /** Billing price id to plan id. */
  prices: Readonly<Record<string, PlanId>>;
  plans: Readonly<Record<PlanId, PlanEntitlements>>;
}

const PriceMapSchema = z.record(z.string().min(1), PlanIdSchema);
const LimitOverridesSchema = z.partialRecord(
  PlanIdSchema,
  z
    .object({
      computerSize: ComputerSizeSchema,
      computers: z.number().int().positive(),
      storageGb: z.number().positive(),
      seatsIncluded: z.number().int().positive(),
      maxSeats: z.number().int().positive(),
      extraSeatPriceId: z.string().min(1),
    })
    .partial()
    .strict(),
);

function parseJson(name: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be JSON`);
  }
}

/**
 * `PLAN_PRICES` turns plans on: a JSON object from billing price id to plan id, for example
 * `{"price_a":"team","price_b":"company"}`. `{}` is valid: every organization then has the
 * personal plan. `PLAN_LIMITS` optionally edits the table, for example
 * `{"team":{"computers":5,"storageGb":150,"extraSeatPriceId":"price_seat"}}`. Unset `PLAN_PRICES` means no limits at all.
 */
export function planConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): PlanConfig | undefined {
  const rawPrices = env.PLAN_PRICES?.trim();
  if (!rawPrices) return undefined;
  const prices = PriceMapSchema.parse(parseJson("PLAN_PRICES", rawPrices));
  const plans = { ...DEFAULT_PLANS };
  const rawLimits = env.PLAN_LIMITS?.trim();
  if (rawLimits) {
    const overrides = LimitOverridesSchema.parse(parseJson("PLAN_LIMITS", rawLimits));
    for (const id of PLAN_IDS) {
      const edit = overrides[id];
      if (!edit) continue;
      const base = plans[id];
      plans[id] = {
        plan: id,
        computerSize: edit.computerSize ?? base.computerSize,
        computers: edit.computers ?? base.computers,
        storageBytes: edit.storageGb ? Math.round(edit.storageGb * GIB) : base.storageBytes,
        seatsIncluded: edit.seatsIncluded ?? base.seatsIncluded,
        maxSeats: Math.max(
          edit.maxSeats ?? base.maxSeats,
          edit.seatsIncluded ?? base.seatsIncluded,
        ),
        ...((edit.extraSeatPriceId ?? base.extraSeatPriceId)
          ? { extraSeatPriceId: edit.extraSeatPriceId ?? base.extraSeatPriceId }
          : {}),
      };
    }
  }
  return { prices, plans };
}

/** A platform owner's custom limits for one organization; what is set replaces the plan's value. */
export const PlanOverrideSchema = z
  .object({
    computerSize: ComputerSizeSchema,
    computers: z.number().int().positive(),
    storageGb: z.number().positive(),
    maxSeats: z.number().int().positive(),
  })
  .partial();
export type PlanOverride = z.infer<typeof PlanOverrideSchema>;

export function applyPlanOverride(
  plan: PlanEntitlements,
  override: PlanOverride | null | undefined,
): PlanEntitlements {
  if (!override) return plan;
  return {
    ...plan,
    computerSize: override.computerSize ?? plan.computerSize,
    computers: override.computers ?? plan.computers,
    storageBytes: override.storageGb ? Math.round(override.storageGb * GIB) : plan.storageBytes,
    maxSeats: override.maxSeats ?? plan.maxSeats,
  };
}

/**
 * The limits an organization has, or null when this deployment has no plans (self-hosted:
 * unlimited). An override replaces the plan's value for that organization. Only a paid subscription on a mapped price leaves the personal plan; no
 * subscription, a trial, or an unmapped price gets personal.
 */
export function resolveEntitlements(
  config: PlanConfig | undefined,
  billing: {
    status: string | null;
    priceId: string | null;
    /** The price's lookup key, which names its plan even when `PLAN_PRICES` does not list the id. */
    priceLookupKey?: string | null;
  } | null,
  override?: PlanOverride | null,
): PlanEntitlements | null {
  if (!config) return null;
  const paid = billing?.status === "active" || billing?.status === "past_due";
  const mapped = paid
    ? ((billing?.priceId ? config.prices[billing.priceId] : undefined) ??
      parsePlanLookupKey(billing?.priceLookupKey)?.plan)
    : undefined;
  return applyPlanOverride(config.plans[mapped ?? FALLBACK_PLAN], override);
}

/** What a plan price's lookup key (`plan_<plan>_<currency>_<interval>`) says; null for any other key. */
export function parsePlanLookupKey(
  key: string | null | undefined,
): { plan: PlanId; currency: BillingCurrency; interval: BillingInterval } | null {
  const match = /^plan_([a-z]+)_(usd|brl)_(month|year)$/.exec(key ?? "");
  const plan = PlanIdSchema.safeParse(match?.[1]);
  if (!match || !plan.success) return null;
  return {
    plan: plan.data,
    currency: match[2] as BillingCurrency,
    interval: match[3] as BillingInterval,
  };
}

/** Share of the storage limit at which the owner is told once per period. */
export const STORAGE_ALERT_RATIO = 0.8;

export function storageLevel(usedBytes: number, limitBytes: number): "ok" | "near" | "full" {
  if (usedBytes >= limitBytes) return "full";
  return usedBytes >= limitBytes * STORAGE_ALERT_RATIO ? "near" : "ok";
}

/** Codes a refused action carries, so each client words it in the member's language. */
export const PLAN_ERROR_CODES = {
  storageFull: "PLAN_STORAGE_FULL",
  computerLimit: "PLAN_COMPUTER_LIMIT",
  seatLimit: "PLAN_SEAT_LIMIT",
} as const;
export type PlanErrorCode = (typeof PLAN_ERROR_CODES)[keyof typeof PLAN_ERROR_CODES];

/** What the plan allows and what the organization uses; absent where plans are off. */
export const PlanUsageSchema = z.object({
  plan: PlanIdSchema,
  computerSize: ComputerSizeSchema,
  computers: z.object({ used: z.number().int().nonnegative(), limit: z.number().int().positive() }),
  storage: z.object({ usedBytes: z.number().nonnegative(), limitBytes: z.number().positive() }),
  seats: z.object({
    /** Members plus pending invites, each person once. */
    used: z.number().int().nonnegative(),
    included: z.number().int().positive(),
    max: z.number().int().positive(),
    /** What one extra seat costs; null where extra seats are free or not offered. */
    extraPrice: z
      .object({
        amount: z.number().int().nonnegative(),
        currency: z.string(),
        interval: z.string(),
      })
      .nullable(),
  }),
  /** Every plan, for the billing page. */
  plans: z.array(PlanEntitlementsSchema),
  /** Only an organization owner can change plan. */
  canManage: z.boolean(),
});
export type PlanUsage = z.infer<typeof PlanUsageSchema>;
