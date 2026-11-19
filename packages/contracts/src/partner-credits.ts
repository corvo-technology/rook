import { z } from "zod";

/**
 * The embedded partner credit model: the partner pays Rook a monthly plan with included credits
 * plus top-ups, and every customer's usage is debited from that one fund. A credit is one US cent
 * of the fund. Nothing about prices lives in code: the platform's pricing is a versioned config
 * written by a platform admin.
 */

const Bps = z.number().int().min(0).max(100_000);
const Micros = z.number().int().nonnegative().max(1_000_000_000_000);
const Currency = z.enum(["BRL", "USD"]);

export const PartnerPlanTierSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  name: z.string().trim().min(1).max(80),
  /** Per currency: what the partner pays each month and the credits that includes. */
  prices: z.record(
    Currency,
    z.object({
      priceMinor: z.number().int().nonnegative().max(2_000_000_000),
      includedCredits: z.number().int().nonnegative().max(2_000_000_000),
    }),
  ),
});

export const PartnerPricingConfigSchema = z
  .object({
    tiers: z.array(PartnerPlanTierSchema).max(20),
    /** What each thing costs Rook, in micro-dollars: the base the margins apply to. */
    costs: z.object({
      /** Per model, per million tokens. */
      models: z.record(
        z.string().min(1).max(120),
        z.object({ inputPer1MMicros: Micros, outputPer1MMicros: Micros }),
      ),
      voiceMinuteMicros: Micros,
      computerMinuteMicros: Micros,
      storageGbMonthMicros: Micros,
    }),
    /** Rook's margin over cost, in basis points, per resource, with optional per-model overrides. */
    margins: z.object({
      tokensBps: Bps,
      perModelBps: z.record(z.string().min(1).max(120), Bps).default({}),
      voiceBps: Bps,
      computerMinuteBps: Bps,
      storageBps: Bps,
    }),
    /** Storage a customer may keep before it is debited, in GB. */
    storageAllowanceGb: z.number().nonnegative().max(1_000_000),
    /** The markup on a top-up; the rest of the payment goes to the fund. */
    topupMarkupBps: Bps,
    /** Days a top-up lasts; null means it does not expire. Plan credits end with the period. */
    topupExpiryDays: z.number().int().positive().max(3650).nullable(),
    /** The share of the fund left that raises `partner.balance_low`, in basis points. */
    lowBalanceBps: z.number().int().min(0).max(10_000),
  })
  .strict();
export type PartnerPricingConfig = z.infer<typeof PartnerPricingConfigSchema>;

export const PartnerPricingVersionSchema = z.object({
  version: z.number().int().positive(),
  config: PartnerPricingConfigSchema,
  createdAt: z.string(),
  /** From when this version is the live one. */
  effectiveAt: z.string(),
});

/** One version in the history: the live one, the ones that ended and the ones still to start. */
export const PartnerPricingHistoryEntrySchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string(),
  effectiveAt: z.string(),
  status: z.enum(["live", "scheduled", "past"]),
});
export type PartnerPricingHistoryEntry = z.infer<typeof PartnerPricingHistoryEntrySchema>;

/** What one typical customer uses in a month. */
export const PartnerUsageMixSchema = z.object({
  models: z
    .array(
      z.object({
        model: z.string().min(1).max(120),
        inputTokens: z.number().int().nonnegative().max(1e12),
        outputTokens: z.number().int().nonnegative().max(1e12),
        /** The customer's own connection (own key, local model, own CLI plan): costs Rook nothing. */
        own: z.boolean().default(false),
      }),
    )
    .max(50)
    .default([]),
  voiceMinutes: z.number().nonnegative().max(1e7).default(0),
  computerMinutes: z.number().nonnegative().max(1e7).default(0),
  storageGb: z.number().nonnegative().max(1e6).default(0),
});

export const PartnerSimulationInputSchema = z.object({
  /** Priced from the live config when `tier` and `currency` are given, or typed in directly. */
  planPriceMinor: z.number().int().nonnegative().max(2_000_000_000),
  includedCredits: z.number().int().nonnegative().max(2_000_000_000),
  customers: z.number().int().positive().max(10_000_000),
  usage: PartnerUsageMixSchema,
  /** Optional: what the plan price is worth in micro-dollars, to report Rook's margin on the plan. */
  planPriceMicros: Micros.optional(),
  /** Simulate against these numbers instead of the live config (an admin trying a draft). */
  config: PartnerPricingConfigSchema.optional(),
});

export const PartnerSimulationSchema = z.object({
  creditsPerCustomer: z.number().int().nonnegative(),
  /** Provider cost per customer in micro-dollars, split by what it is spent on. */
  costPerCustomer: z.object({
    modelsMicros: z.number().int().nonnegative(),
    infraMicros: z.number().int().nonnegative(),
  }),
  /** Rook's margin per customer in micro-dollars. */
  marginPerCustomerMicros: z.number().int().nonnegative(),
  /** How many customers the plan's included credits cover; null when a customer costs nothing. */
  customersSupported: z.number().int().nonnegative().nullable(),
  fund: z.object({
    creditsNeeded: z.number().int().nonnegative(),
    covered: z.boolean(),
    shortfallCredits: z.number().int().nonnegative(),
  }),
  /** Rook's margin on the whole fund use plus, when given, the plan price less the provider cost. */
  totalMarginMicros: z.number().int(),
  planMarginMicros: z.number().int().nullable(),
});
export type PartnerSimulation = z.infer<typeof PartnerSimulationSchema>;

/** Per-customer credit use shown in the console. */
export const PartnerCreditCustomerSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  usedCredits: z.number().int().nonnegative(),
  limitCredits: z.number().int().nullable(),
  /** Credits by model name, plus `other` for what is not a model call. */
  byResource: z.record(z.string(), z.number().int()),
});

export const PartnerCreditsSchema = z.object({
  currency: Currency,
  plan: z
    .object({
      name: z.string(),
      priceMinor: z.number().int(),
      includedCredits: z.number().int(),
      periodEnd: z.string().nullable(),
    })
    .nullable(),
  balance: z.object({ planCredits: z.number().int(), topupCredits: z.number().int() }),
  autoTopup: z.object({
    enabled: z.boolean(),
    thresholdCredits: z.number().int().nullable(),
    amountMinor: z.number().int().nullable(),
  }),
  allowedModels: z.array(z.string()),
  customers: z.array(PartnerCreditCustomerSchema),
});

export type PartnerCredits = z.infer<typeof PartnerCreditsSchema>;

/** One partner as the platform operators see it for a month. Credits are US cents of the fund. */
export const PlatformPartnerSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  mode: z.enum(["embedded", "white_label", "referral"]),
  /** The partner plan (a tier key of the published pricing), for embedded partners. */
  plan: z.string().nullable(),
  /** Customers whose space is enabled. */
  activeCustomers: z.number().int().nonnegative(),
  /** What is left in the fund, and the share of fund plus this month's use that it is. */
  fundBalanceCredits: z.number().int(),
  fundPercent: z.number().int().min(0).max(100).nullable(),
  /** What customers' use was charged to the fund this month. */
  chargedCredits: z.number().int().nonnegative(),
  /** What the providers charged Rook for that use; null when it is not reported. */
  costCredits: z.number().int().nonnegative().nullable(),
  /** Test mode: customers made with the test key, the model calls they made today, and the daily cap. */
  testCustomers: z.number().int().nonnegative(),
  testCallsToday: z.number().int().nonnegative(),
  testDailyCap: z.number().int().nonnegative(),
});
export type PlatformPartner = z.infer<typeof PlatformPartnerSchema>;

/** Who asked to get in, and what an operator decided. */
export const PlatformDecisionSchema = z.enum(["pending", "approved", "declined"]);

export const PlatformWaitlistEntrySchema = z.object({
  id: z.string(),
  email: z.string(),
  company: z.string(),
  task: z.string().nullable(),
  locale: z.string().nullable(),
  status: PlatformDecisionSchema,
  createdAt: z.string(),
});

export const PlatformPartnerLeadSchema = z.object({
  id: z.string(),
  name: z.string(),
  company: z.string(),
  email: z.string(),
  whatsapp: z.string().nullable(),
  website: z.string().nullable(),
  partnerType: z.string(),
  country: z.string().nullable(),
  customers: z.string().nullable(),
  message: z.string().nullable(),
  status: PlatformDecisionSchema,
  createdAt: z.string(),
});

export type PlatformWaitlistEntry = z.infer<typeof PlatformWaitlistEntrySchema>;
export type PlatformPartnerLead = z.infer<typeof PlatformPartnerLeadSchema>;

/** A partner an operator makes: the product, how it is billed and the plan it is on. */
export const PlatformNewPartnerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/),
  mode: z.enum(["embedded", "white_label", "referral"]),
  /** Two letters; Brazil bills in reais, everywhere else in dollars. */
  country: z.string().trim().length(2),
  /** A tier of the published pricing; only embedded partners are on a plan. */
  planKey: z.string().max(40).nullish(),
});
