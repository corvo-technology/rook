import { z } from "zod";

/**
 * White label collection (docs/partner-commerce.md, 4.2, 7.2 and 9): what a customer on a partner's
 * domain sees of the price list, what a partner sees of its receipts, and what Rook's admins see of
 * the connected accounts. Money is minor units with a `currency`.
 */

const Id = z.string().min(1).max(128);
const Minor = z.number().int().nonnegative().max(2_000_000_000);
const Currency = z.enum(["BRL", "USD"]);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const ConnectStateSchema = z.enum(["none", "pending", "restricted", "active", "disabled"]);

/** One plan or pack at the partner's price. The split between Rook and the partner is not shown. */
export const WhiteLabelItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** The AI credit it includes, in the same currency. */
  creditMinor: Minor,
  priceMinor: Minor,
});

/** What a customer reads of the partner's price list and of its own plan; null for anyone else. */
export const WhiteLabelCatalogSchema = z.object({
  currency: Currency,
  plans: z.array(WhiteLabelItemSchema),
  packs: z.array(WhiteLabelItemSchema),
  /** The plan the customer is on; null before the first one. `pending` is a downgrade waiting. */
  subscription: z
    .object({
      planKey: z.string(),
      pendingPlanKey: z.string().nullable(),
      state: z.enum(["active", "past_due", "canceled", "lapsed"]),
      periodEnd: z.string(),
    })
    .nullable(),
  /** False until the partner can take payments; a plan cannot be bought before. */
  canPay: z.boolean(),
});

export const WhiteLabelCheckoutInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("plan"), key: z.string().min(1).max(64) }),
  z.object({
    kind: z.literal("pack"),
    key: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(100).default(1),
  }),
]);

export const PartnerPaymentsSchema = z.object({
  /** Where the connected account stands; `none` until the partner starts. */
  state: ConnectStateSchema,
  /** The last characters of the account, enough to tell it from another. */
  accountHint: z.string().nullable(),
  /** What the payment provider still needs from the partner. */
  requirementsDue: z.array(z.string()),
  /** False when the deployment has no payment provider configured. */
  available: z.boolean(),
  payouts: z.array(
    z.object({
      id: Id,
      amountMinor: Minor,
      currency: Currency,
      status: z.enum(["paid", "failed"]),
      arrivedAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  disputes: z.array(
    z.object({
      id: Id,
      amountMinor: Minor,
      currency: Currency,
      reason: z.string(),
      status: z.string(),
      createdAt: z.string(),
    }),
  ),
});

export const PlatformConnectPartnerSchema = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  currency: Currency,
  state: ConnectStateSchema,
  accountHint: z.string().nullable(),
  customers: z.number().int().nonnegative(),
  disputesOpen: z.number().int().nonnegative(),
});

export const PlatformReconciliationSchema = z.object({
  period: Period,
  rows: z.array(
    z.object({
      partnerId: Id,
      partnerName: z.string(),
      currency: Currency,
      /** Rook's share by the ledger, net of refunds. */
      ledgerMinor: z.number().int(),
      /** What the payment provider took as fees, net of fees handed back. */
      providerMinor: z.number().int(),
      differenceMinor: z.number().int(),
    }),
  ),
});
