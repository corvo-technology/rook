import { z } from "zod";

/**
 * The partner console (docs/partner-commerce.md, section 6): what a partner's organization sees
 * and does about its customers. Money is minor units with a `currency`; nothing here carries a
 * customer's conversations, only numbers and states.
 */

const Id = z.string().min(1).max(128);
const Minor = z.number().int().nonnegative().max(2_000_000_000);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Currency = z.enum(["BRL", "USD"]);

export const PartnerConsolePartnerSchema = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  mode: z.enum(["embedded", "white_label"]),
  currency: Currency,
  accent: z.string().nullable(),
  chiefName: z.string().nullable(),
});
export type PartnerConsolePartner = z.infer<typeof PartnerConsolePartnerSchema>;

export const PartnerConsoleAttentionSchema = z.object({
  kind: z.enum(["credit_low", "past_due", "connector_down", "invoice_issued"]),
  tenantId: Id.optional(),
  tenantName: z.string().optional(),
  /** A number or a state, such as "82%" or "2026-10"; never customer content. */
  detail: z.string(),
  at: z.string(),
});

export const PartnerConsoleOverviewSchema = z.object({
  currency: Currency,
  /** What the partner earns in the period: `commission` plus `markup`. */
  revenue: z.object({ total: Minor, commission: Minor, markup: Minor }),
  activeCustomers: z.number().int().nonnegative(),
  newCustomers: z.number().int().nonnegative(),
  creditLow: z.number().int().nonnegative(),
  pastDue: z.number().int().nonnegative(),
  monthly: z.array(z.object({ month: Period, total: Minor })),
  attention: z.array(PartnerConsoleAttentionSchema),
});

export const PartnerConsoleCustomerFilter = z.enum(["all", "credit_low", "past_due", "paused"]);
export type PartnerConsoleCustomerFilter = z.infer<typeof PartnerConsoleCustomerFilter>;

export const PartnerConsoleCustomerState = z.enum(["active", "past_due", "lapsed", "paused"]);

export const PartnerConsoleCustomerSchema = z.object({
  tenantId: Id,
  name: z.string(),
  /** The plan's name; null for a customer with none. */
  plan: z.string().nullable(),
  /** 0 to 100; null when the customer has no plan credit to measure. */
  creditUsedPct: z.number().int().min(0).max(100).nullable(),
  creditRemaining: z.number().int(),
  state: PartnerConsoleCustomerState,
  since: z.string(),
});

export const PartnerConsoleCustomerDetailSchema = PartnerConsoleCustomerSchema.extend({
  agents: z.array(z.string()),
  connector: z.enum(["ok", "down", "none"]),
  runs30d: z.number().int().nonnegative(),
  balance: z.object({
    currency: Currency,
    remaining: z.number().int(),
    planRemaining: z.number().int(),
    topupRemaining: z.number().int(),
    periodEnd: z.string().nullable(),
  }),
  /** What the subscription costs now: its snapshot until the period ends, then the current price. */
  priceMinor: z.number().int().nullable(),
});

export const PartnerConsoleCustomersInput = z.object({
  partnerId: Id,
  filter: PartnerConsoleCustomerFilter.default("all"),
  q: z.string().trim().max(80).optional(),
  cursor: z.string().max(300).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const PartnerConsoleActionInput = z
  .object({
    partnerId: Id,
    tenantId: Id,
    action: z.enum(["pause", "resume", "add_credit"]),
    /** Required for `add_credit`, in the partner's minor units. */
    amountMinor: Minor.positive().optional(),
    /** The same key and request answers the same and acts once. */
    idempotencyKey: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict()
  .refine((input) => (input.action === "add_credit") === (input.amountMinor !== undefined), {
    message: "amountMinor goes with add_credit only",
  });

export const PartnerConsoleActionResultSchema = z.object({
  state: PartnerConsoleCustomerState,
  /** Minor units left after an `add_credit`. */
  creditRemaining: z.number().int(),
  /** True when the key had been used and this is the first answer again. */
  replayed: z.boolean(),
});

export const MarkupKindSchema = z.enum(["fixed", "percent"]);

/** `value` is minor units for "fixed" and basis points (1500 is 15%) for "percent". */
export const PartnerConsoleMarkupSchema = z.object({
  kind: MarkupKindSchema,
  value: z.number().int().nonnegative().max(2_000_000_000),
});

export const PartnerConsolePricedItemSchema = z.object({
  /** `plan:<key>` or `pack:<key>`; what `setPricing` takes. */
  itemId: z.string(),
  /** The catalog key, which a subscription's plan names. */
  planId: z.string(),
  name: z.string(),
  creditMinor: Minor,
  baseMinor: Minor,
  /** The partner's share of the base. */
  commissionMinor: Minor,
  markup: PartnerConsoleMarkupSchema,
  markupMinor: Minor,
  /** What the customer pays: base plus markup. */
  finalMinor: Minor,
});

export const PartnerConsolePricingSchema = z.object({
  currency: Currency,
  commissionBps: z.number().int().min(0).max(10_000),
  checkoutUrl: z.string().nullable(),
  plans: z.array(PartnerConsolePricedItemSchema),
  packs: z.array(PartnerConsolePricedItemSchema),
});

/** Strict on purpose: commission, mode, country and currency are Rook's to set, not the partner's. */
export const PartnerConsoleSetPricingInput = z
  .object({
    partnerId: Id,
    checkoutUrl: z.string().trim().max(2048).nullable().optional(),
    markups: z
      .array(z.object({ itemId: z.string().max(60), ...PartnerConsoleMarkupSchema.shape }).strict())
      .max(200)
      .default([]),
  })
  .strict();

export const PartnerConsoleRevenueLineSchema = z.object({
  id: Id,
  at: z.string(),
  tenantId: Id,
  tenantName: z.string(),
  kind: z.enum(["subscription", "topup", "refund", "adjustment"]),
  baseMinor: z.number().int(),
  rookShareMinor: z.number().int(),
  commissionMinor: z.number().int(),
  markupMinor: z.number().int(),
  paidMinor: z.number().int(),
});

export const PartnerConsoleRevenueSchema = z.object({
  currency: Currency,
  period: Period,
  lines: z.array(PartnerConsoleRevenueLineSchema),
  totals: z.object({
    baseMinor: z.number().int(),
    rookShareMinor: z.number().int(),
    commissionMinor: z.number().int(),
    markupMinor: z.number().int(),
    paidMinor: z.number().int(),
    /** What the partner earns: commission plus markup. */
    partnerMinor: z.number().int(),
  }),
  invoices: z.array(
    z.object({
      id: Id,
      period: Period,
      state: z.enum(["draft", "issued", "paid", "void"]),
      totalMinor: z.number().int(),
    }),
  ),
});

export const PartnerConsoleIntegrationSchema = z.object({
  /** The key itself is shown once, when it is issued; only its start is kept in view. */
  keys: z.array(z.object({ prefix: z.string(), createdAt: z.string() })),
  webhook: z.object({ url: z.string().nullable(), enabled: z.boolean() }),
  docsUrl: z.string(),
});

export type PartnerConsolePricing = z.infer<typeof PartnerConsolePricingSchema>;
