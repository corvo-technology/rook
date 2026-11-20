import { z } from "zod";
import { AssistPresets } from "./assist.js";
import { BotStartersSchema } from "./bot-starters.js";
import { PartnerEventRoutine } from "./partner-events.js";
import { PartnerScheduledRoutine } from "./partner-scheduled.js";
import { TimeZoneSchema } from "./time-zone.js";

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

/** One tappable shortcut on the embedded Home: a message for the Chief, or a place in the partner's product. */
export const PartnerQuickAction = z
  .object({
    label: z.string().trim().min(1).max(60),
    /** Sent to the Chief when tapped. */
    prompt: z.string().trim().min(1).max(500).optional(),
    /** A path in the partner's own product, handed to the page that embeds Rook. */
    open: z
      .string()
      .regex(/^\/(?!\/)[^\s]*$/)
      .max(200)
      .optional(),
  })
  .strict()
  .refine((action) => Boolean(action.prompt) !== Boolean(action.open), {
    message: "Give either a prompt or a path to open",
  });
export type PartnerQuickAction = z.infer<typeof PartnerQuickAction>;

/** A person's role in the partner's own system: `owner`, `manager`, `reception`, `professional` or a name of the partner's. */
export const PartnerRoleName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{0,31}$/);
export type PartnerRoleName = z.infer<typeof PartnerRoleName>;

/** The roles every partner shares; any other name is the partner's own. */
export const PARTNER_ROLES = ["owner", "manager", "reception", "professional"] as const;

const ScopeValue = z.union([Key, z.array(Key).max(50)]);

/** What a person may reach in the partner's data, such as `{ professionalId, branchIds }`. */
export const PartnerSessionScope = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), ScopeValue)
  .refine((scope) => Object.keys(scope).length <= 10, { message: "Too many scope fields" });
export type PartnerSessionScope = z.infer<typeof PartnerSessionScope>;

/** Areas of the embedded app a role can lose on top of the partner's own `hide`. */
export const PARTNER_ROLE_HIDEABLE_AREAS = ["team", "billing", "settings"] as const;

/** What one role gets in a customer: its agents, the rights it holds and what it does not see. */
export const PartnerRoleDef = z
  .object({
    /** The keys of the template agents this role talks to; `*` is all of them. */
    agents: z.array(z.union([Key, z.literal("*")])).max(10),
    /** Rights in the customer's space, such as `talk_to_agents` or `approve_actions`. */
    permissions: z.array(z.string().min(1).max(40)).max(40).default([]),
    /** Areas the role does not see, on top of the template's own `hide`. */
    hide: z
      .array(z.enum([...PARTNER_HIDEABLE_AREAS, ...PARTNER_ROLE_HIDEABLE_AREAS]))
      .max(10)
      .optional(),
  })
  .strict();
export type PartnerRoleDef = z.infer<typeof PartnerRoleDef>;

/** What every new customer gets, defined once so the partner's calls only name the customer. */
export const PartnerTemplateObject = z
  .object({
    connector: PartnerConnectorInput.omit({ token: true }).optional(),
    agents: z.array(PartnerAgentInput).max(10),
    /** Whether customers may pick a model; the deployment's own is used unless "choose". */
    models: z.enum(["fixed", "choose"]).optional(),
    /** Left out of the bar for the partner's customers. */
    hide: z.array(PartnerHiddenArea).max(PARTNER_HIDEABLE_AREAS.length).optional(),
    /** What a new customer's Chief is called; the localized default when left out. */
    chiefName: z.string().trim().min(1).max(80).optional(),
    /** Shortcuts on the embedded Home, in order. */
    quickActions: z.array(PartnerQuickAction).max(6).optional(),
    /** Tasks the partner's pages run by name (`Rook.ask({ preset })`), as data. */
    assist: AssistPresets.optional(),
    /** Routines every customer gets, each started by an event the partner's system sends. */
    routines: z.array(PartnerEventRoutine).max(20).optional(),
    /** Routines every customer gets, each started by the clock. Together with `routines`, at most 20. */
    scheduledRoutines: z.array(PartnerScheduledRoutine).max(20).optional(),
    /** The timezone scheduled routines run in when the customer's call names none; UTC when left out. */
    timezone: TimeZoneSchema.optional(),
    /** What each role of the partner's system gets; a role named nowhere here gets no agents. */
    roles: z.record(PartnerRoleName, PartnerRoleDef).optional(),
    /** The partner's main colour as `#rrggbb`, used when the page that embeds Rook passes none. */
    accent: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .optional(),
  })
  .strict();

export const PartnerTemplate = PartnerTemplateObject.superRefine((template, ctx) => {
  if ((template.routines?.length ?? 0) + (template.scheduledRoutines?.length ?? 0) > 20) {
    ctx.addIssue({
      code: "custom",
      message: "A template gives at most 20 routines",
      path: ["scheduledRoutines"],
    });
  }
  if (!template.scheduledRoutines?.length) return;
  const keys = new Set<string>();
  for (const routine of [...(template.routines ?? []), ...template.scheduledRoutines]) {
    if (keys.has(routine.key)) {
      ctx.addIssue({
        code: "custom",
        message: "Routine keys must be unique",
        path: ["scheduledRoutines"],
      });
      break;
    }
    keys.add(routine.key);
  }
});
export type PartnerTemplate = z.infer<typeof PartnerTemplate>;

/** What a partner's system sends to create or update one of its customers; sending it again is safe. */
export const PartnerTenantInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** The customer's language, such as `pt-BR`; names its Chief. Anything else reads as English. */
    locale: z.string().trim().max(35).optional(),
    /** The customer's IANA timezone, such as `America/Sao_Paulo`; scheduled routines run in it. */
    timezone: TimeZoneSchema.optional(),
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

/** One person of a customer, as the partner console lists them. */
export const PartnerMemberSchema = z.object({
  externalUserId: z.string(),
  email: z.string().nullable(),
  role: z.string(),
  scope: z.record(z.string(), z.unknown()).nullable(),
  lastSeenAt: z.string(),
});
export type PartnerMember = z.infer<typeof PartnerMemberSchema>;

export const PartnerTenantResult = z.object({ tenantId: z.string(), created: z.boolean() });
export type PartnerTenantResult = z.infer<typeof PartnerTenantResult>;

export const PartnerSessionInput = z
  .object({
    externalTenantId: Key,
    externalUserId: Key,
    email: z.email().max(320).optional(),
    /** Left out, the person is the customer's owner, as sessions were before roles. */
    role: PartnerRoleName.optional(),
    /** Passed to the partner's connector with every call, so the partner can filter its own data. */
    scope: PartnerSessionScope.optional(),
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
  "subscription.updated",
  "subscription.lapsed",
  "credit.granted",
  "credit.expired",
  "invoice.issued",
  "customer.credit_limit_reached",
  "partner.balance_low",
  "payment.failed",
  "payment.refunded",
  "payment.disputed",
  "payout.paid",
] as const;
export type PartnerWebhookEventType = (typeof PARTNER_WEBHOOK_EVENTS)[number];

/**
 * What a partner's people are told, by email and in the app. Webhooks stay a separate, optional
 * integration; the kinds that exist there use the same names.
 */
export const PARTNER_ALERT_KINDS = [
  "customer.credit_limit_reached",
  "partner.balance_low",
  "partner.autotopup_started",
  "partner.autotopup_failed",
  "invoice.issued",
  "subscription.lapsed",
  "customer.connector_down",
] as const;
export type PartnerAlertKind = (typeof PARTNER_ALERT_KINDS)[number];

/** The inbox code of each alert, so every client words it in the member's language. */
export const PARTNER_ALERT_CODES = {
  "customer.credit_limit_reached": "partner_limit_reached",
  "partner.balance_low": "partner_balance_low",
  "partner.autotopup_started": "partner_autotopup_started",
  "partner.autotopup_failed": "partner_autotopup_failed",
  "invoice.issued": "partner_invoice_issued",
  "subscription.lapsed": "partner_past_due",
  "customer.connector_down": "partner_connector_down",
} as const satisfies Record<PartnerAlertKind, string>;

/** The console screen an alert leads to. */
export const PARTNER_ALERT_SECTIONS = {
  "customer.credit_limit_reached": "customers",
  "partner.balance_low": "credits",
  "partner.autotopup_started": "credits",
  "partner.autotopup_failed": "credits",
  "invoice.issued": "invoices",
  "subscription.lapsed": "customers",
  "customer.connector_down": "customers",
} as const satisfies Record<PartnerAlertKind, string>;

/**
 * The pilot's credit notice, in cents. Commerce events (`subscription.*`, `credit.*`,
 * `invoice.issued`, and `tenant.allowance_*` for commerce customers) carry `currency` and minor
 * units instead; see docs/partner-commerce.md.
 */
export interface PartnerWebhookPayload {
  id: string;
  type: PartnerWebhookEventType;
  createdAt: string;
  externalTenantId?: string;
  /** The month the credit was granted for, such as 2026-11. */
  period?: string;
  grantedCents?: number;
  usedCents?: number;
  remainingCents?: number;
  [field: string]: unknown;
}

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Minor = z.number().int().nonnegative().max(2_000_000_000);
const IsoInstant = z.iso.datetime({ offset: true });

/** `PUT /tenants/{id}/subscription`. Trials are not offered: a plan is active, past due or canceled. */
export const PartnerSubscriptionInput = z
  .object({
    plan: Key,
    status: z.enum(["active", "past_due", "canceled"]),
    currentPeriodStart: IsoInstant,
    currentPeriodEnd: IsoInstant,
    /** What the customer actually paid, for statements and the markup. */
    chargedMinor: Minor.optional(),
    /** The partner's payment id; a later refund names it. */
    externalPaymentId: Key.optional(),
  })
  .strict();
export type PartnerSubscriptionInput = z.infer<typeof PartnerSubscriptionInput>;

/** `POST /tenants/{id}/topups`. */
export const PartnerTopupInput = z
  .object({
    pack: Key,
    quantity: z.number().int().min(1).max(100).default(1),
    paidMinor: Minor,
    externalPaymentId: Key,
  })
  .strict();
export type PartnerTopupInput = z.infer<typeof PartnerTopupInput>;

/** `POST /tenants/{id}/refunds`; without an amount the whole payment is refunded. */
export const PartnerRefundInput = z
  .object({
    externalPaymentId: Key,
    amountMinor: Minor.positive().optional(),
  })
  .strict();
export type PartnerRefundInput = z.infer<typeof PartnerRefundInput>;

export const PartnerUsageQuery = z.object({ period: Period });

export const PARTNER_SCOPES = ["tenants:write", "commerce:read", "commerce:write"] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

/**
 * What a commerce customer reads of its own balance, in integer minor units of `currency` (cents or
 * centavos). "R$ 18 of R$ 30 this month" is `remaining` of `planCredit`: `remaining` is the plan
 * credit still unspent this period, and `topupRemaining` is purchased credit on top of it, which
 * survives the period end. Sold out is `remaining + topupRemaining <= 0`.
 *
 * `state`: "active" (a plan in force, including one canceled until its period ends), "past_due"
 * (grace period, still usable) or "lapsed" (plan inactive or none: runs are refused, data stays
 * readable).
 */
export const PartnerBalanceSchema = z.object({
  currency: z.enum(["BRL", "USD"]),
  planName: z.string().nullable(),
  planCredit: Minor,
  used: Minor,
  remaining: Minor,
  topupRemaining: Minor,
  periodEnd: z.string().nullable(),
  state: z.enum(["active", "past_due", "lapsed"]),
  /** The partner's checkout with the customer filled in; null when it has none. */
  checkoutUrl: z.string().nullable(),
  /** White label: buying more happens in the app itself, on the plans screen. */
  buyInApp: z.boolean().optional(),
  lowThresholdReached: z.boolean(),
});
export type PartnerBalance = z.infer<typeof PartnerBalanceSchema>;

export const PartnerInvoiceSchema = z.object({
  id: z.string(),
  partner: z.string(),
  period: Period,
  currency: z.string(),
  state: z.enum(["draft", "issued", "paid", "void"]),
  totalMinor: z.number().int(),
  lines: z.number().int(),
  dueAt: z.string().nullable(),
  externalRef: z.string().nullable(),
});
export type PartnerInvoice = z.infer<typeof PartnerInvoiceSchema>;
