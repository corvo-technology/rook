import { z } from "zod";
import { BotStartersSchema } from "./bot-starters.js";

const Key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/);

export const PartnerConnectorInput = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/),
    name: z.string().trim().min(1).max(80),
    endpoint: z.url().max(2048),
    /** Sent to the partner's own server as a bearer token; stored only in the sealed secret store. */
    token: z.string().min(1).max(4096),
  })
  .strict();

export const PartnerAgentInput = z
  .object({
    key: Key,
    name: z.string().trim().min(1).max(80),
    instructions: z.string().max(20_000),
    usesConnector: z.boolean().default(false),
    /** Tappable first messages while the agent's chat is empty. */
    starters: BotStartersSchema.optional(),
  })
  .strict();

/** Areas of the app a partner can leave out for its customers; agents are always there. */
export const PARTNER_HIDEABLE_AREAS = [
  "routines",
  "workflows",
  "usage",
  "artifacts",
  "store",
] as const;
export const PartnerHiddenArea = z.enum(PARTNER_HIDEABLE_AREAS);
export type PartnerHiddenArea = z.infer<typeof PartnerHiddenArea>;

/** What every new customer gets, defined once so the partner's calls only name the customer. */
export const PartnerTemplate = z
  .object({
    connector: PartnerConnectorInput.omit({ token: true }).optional(),
    agents: z.array(PartnerAgentInput).max(10),
    /** Whether customers may pick a model; the deployment's own is used unless "choose". */
    models: z.enum(["fixed", "choose"]).optional(),
    /** Left out of the bar for the partner's customers. */
    hide: z.array(PartnerHiddenArea).max(PARTNER_HIDEABLE_AREAS.length).optional(),
    /** What a new customer's Chief is called; the localized default when left out. */
    chiefName: z.string().trim().min(1).max(80).optional(),
    /** The partner's main colour as `#rrggbb`, used when the page that embeds Rook passes none. */
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .strict();
export type PartnerTemplate = z.infer<typeof PartnerTemplate>;

/** What a partner's system sends to create or update one of its customers; sending it again is safe. */
export const PartnerTenantInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** The customer's language, such as `pt-BR`; names its Chief. Anything else reads as English. */
    locale: z.string().trim().max(35).optional(),
    state: z.enum(["enabled", "suspended"]).optional(),
    connector: PartnerConnectorInput.optional(),
    agents: z.array(PartnerAgentInput).max(10).optional(),
    /** Pairs with the template's connector, which has no token of its own. */
    connectorToken: z.string().min(1).max(4096).optional(),
    allowanceCents: z.number().int().positive().max(100_000_000).optional(),
    /** A month such as 2026-11; defaults to the current one. */
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();
export type PartnerTenantInput = z.infer<typeof PartnerTenantInput>;

export const PartnerTenantResult = z.object({ tenantId: z.string(), created: z.boolean() });
export type PartnerTenantResult = z.infer<typeof PartnerTenantResult>;

export const PartnerSessionInput = z
  .object({
    externalTenantId: Key,
    externalUserId: Key,
    email: z.email().max(320).optional(),
  })
  .strict();
export type PartnerSessionInput = z.infer<typeof PartnerSessionInput>;

/** `code` is for an embedded frame, which trades it for a session token; `url` is for a redirect. */
export const PartnerSessionResult = z.object({
  url: z.string(),
  code: z.string(),
  expiresAt: z.string(),
});
export type PartnerSessionResult = z.infer<typeof PartnerSessionResult>;

/** The limits a partner sets on what it passes on, in US dollars; null removes a limit. */
export const PartnerLimitsInput = z.object({
  perTenantLimitUsd: z.number().min(0).max(100_000).nullable(),
  monthlyLimitUsd: z.number().min(0).max(1_000_000).nullable(),
});
export type PartnerLimitsInput = z.infer<typeof PartnerLimitsInput>;

/** What the person who runs a partner sees in the app. */
export const PartnerAccountSchema = z.object({
  name: z.string(),
  /** The start of the key, so a key in use can be recognised; the key itself is shown once. */
  keyPrefix: z.string(),
  template: PartnerTemplate.nullable(),
  /**
   * The credit the partner passes on from, which is the owner's own account; null when this
   * partner is not paid for from one. Limits are in US dollars; null means none.
   */
  wallet: z
    .object({
      balanceUsd: z.number(),
      passedOnUsd: z.number(),
      perTenantLimitUsd: z.number().nullable(),
      monthlyLimitUsd: z.number().nullable(),
    })
    .nullable(),
  tenants: z.array(
    z.object({
      externalTenantId: z.string(),
      name: z.string(),
      state: z.enum(["enabled", "suspended"]),
      /** Model spend this calendar month, and what is left to spend, in US dollars. */
      usedUsd: z.number(),
      balanceUsd: z.number(),
    }),
  ),
});
export type PartnerAccount = z.infer<typeof PartnerAccountSchema>;

/** What a partner's webhook is told, in the JSON body of a signed POST. It never carries a secret. */
export const PARTNER_WEBHOOK_EVENTS = [
  "tenant.allowance_low",
  "tenant.allowance_exhausted",
] as const;
export type PartnerWebhookEventType = (typeof PARTNER_WEBHOOK_EVENTS)[number];

export interface PartnerWebhookPayload {
  id: string;
  type: PartnerWebhookEventType;
  createdAt: string;
  externalTenantId: string;
  /** The month the credit was granted for, such as 2026-11. */
  period: string;
  grantedCents: number;
  usedCents: number;
  remainingCents: number;
}
