import type { PartnerAlertKind, PartnerConsoleEvents, PartnerTemplate } from "@corvo/contracts";
import type { CatalogView, IdempotentOutcome, MarkupKind, MarkupRule } from "@corvo/db";

/**
 * The partner console's service layer: plain functions that take the store and who is asking, so
 * the oRPC routes and the agent tools run exactly the same code. Everything here is scoped to one
 * organization: it only ever reaches partners that organization manages, and returns numbers and
 * states, never what a customer wrote or said.
 */

/** Who is asking: the organization whose partners may be reached, and the person acting, if any. */
export interface PartnerScope {
  organizationId: string;
  /** Recorded in the audit trail; null for a job or an agent with no person behind it. */
  actorUserId?: string | null;
}

export type CustomerState = "active" | "past_due" | "lapsed" | "paused";
export type ConnectorState = "ok" | "down" | "none";
export type PartnerCurrency = "BRL" | "USD";

export interface PartnerRecord {
  id: string;
  slug: string;
  name: string;
  mode: "embedded" | "white_label";
  currency: PartnerCurrency;
  billingModel: "wallet" | "commerce";
  commissionBps: number;
  checkoutUrl: string | null;
  keyPrefix: string;
  webhookUrl: string | null;
  /** Test mode: the test key's start (null until one is made) and where test notices go. */
  testKeyPrefix: string | null;
  testWebhookUrl: string | null;
  accent: string | null;
  chiefName: string | null;
  /** What every new customer gets; null when the partner has none. */
  template: PartnerTemplate | null;
  createdAt: Date;
}

/** One customer as the console reads it; computed from the ledger and the credit lots. */
export interface CustomerRow {
  tenantId: string;
  externalTenantId: string;
  organizationId: string;
  name: string;
  plan: string | null;
  planKey: string | null;
  /** 0 to 100, or null when there is no plan credit to measure. */
  creditUsedPct: number | null;
  creditRemaining: number;
  state: CustomerState;
  since: Date;
  /** The share of plan credit used has reached the notice threshold. */
  lowCredit: boolean;
  /** Made with the partner's test key. */
  test?: boolean;
  connector: ConnectorState;
  connectorCheckedAt: Date | null;
  pastDueSince: Date | null;
  /** The price the subscription was sold at, kept until it renews. */
  subscription: { baseMinor: number; markupMinor: number; periodEnd: Date } | null;
}

export interface CustomerDetailExtras {
  agents: string[];
  runs30d: number;
  planRemaining: number;
  topupRemaining: number;
  periodEnd: Date | null;
}

export interface RevenueEntryRow {
  id: string;
  createdAt: Date;
  tenantId: string;
  tenantName: string;
  kind: string;
  baseMinor: number;
  rookShareMinor: number;
  partnerCommissionMinor: number;
  markupMinor: number;
  paidMinor: number;
}

export interface InvoiceRow {
  id: string;
  period: string;
  state: "draft" | "issued" | "paid" | "void";
  totalMinor: number;
  issuedAt: Date | null;
}

export interface MarkupChange {
  itemKind: "plan" | "pack";
  itemKey: string;
  kind: MarkupKind;
  /** Zero removes the markup. */
  value: number;
}

export type AuditKind =
  | "customer.paused"
  | "customer.resumed"
  | "customer.credit_added"
  | "support.session_opened"
  | "pricing.changed"
  | "key.rotated"
  | "test_key.rotated"
  | "test_webhook.changed"
  | "test_data.cleared"
  | "webhook.changed"
  | "template.changed"
  | "credit.limit_changed"
  | "credit.models_changed"
  | "credit.autotopup_changed"
  | "credit.topup_started"
  | "credit.autotopup_started"
  | "credit.autotopup_failed"
  | "brand.changed"
  | "domain.changed";

export interface CreditUsage {
  /** Credits that end with the plan's period, and credits that stay until used. */
  planCredits: number;
  topupCredits: number;
  /** The partner's monthly plan; null when it has none. */
  plan: {
    tierKey: string;
    priceMinor: number;
    includedCredits: number;
    periodEnd: Date;
    status: string;
  } | null;
  customers: Array<{
    tenantId: string;
    name: string;
    usedCredits: number;
    limitCredits: number | null;
    byResource: Record<string, number>;
  }>;
  autoTopup: { enabled: boolean; thresholdCredits: number | null; amountMinor: number | null };
  allowedModels: string[];
}

/** What the service needs from storage. The Prisma store is the one real implementation. */
export interface PartnerConsoleStore {
  /** Only the partners the organization is a member of. */
  listPartners(organizationId: string): Promise<PartnerRecord[]>;
  /** Null for a partner the organization does not manage, whether or not it exists. */
  findPartner(organizationId: string, partnerId: string): Promise<PartnerRecord | null>;
  /** The partner's live customers, or with "test" the ones made with its test key. */
  customerRows(partner: PartnerRecord, now: Date, mode?: "live" | "test"): Promise<CustomerRow[]>;
  customerDetail(
    partner: PartnerRecord,
    row: CustomerRow,
    now: Date,
  ): Promise<CustomerDetailExtras>;
  setTenantState(
    partner: PartnerRecord,
    row: CustomerRow,
    state: "enabled" | "suspended",
  ): Promise<void>;
  /** Adds credit once per key; throws a `PartnerConsoleError` the caller can act on. */
  addCredit(
    partner: PartnerRecord,
    row: CustomerRow,
    input: { amountMinor: number; key: string },
    now: Date,
  ): Promise<void>;
  createEntryCode(input: {
    partnerId: string;
    tenantId: string;
    codeHash: string;
    actorUserId: string | null;
    expiresAt: Date;
  }): Promise<void>;
  idempotent(
    partnerId: string,
    key: string,
    hash: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<IdempotentOutcome>;
  catalog(partner: PartnerRecord): Promise<CatalogView>;
  markups(partnerId: string): Promise<Map<string, MarkupRule>>;
  replaceMarkups(partnerId: string, changes: MarkupChange[]): Promise<void>;
  setCheckoutUrl(partner: PartnerRecord, url: string | null): Promise<void>;
  revenueEntries(partnerId: string, period: string): Promise<RevenueEntryRow[]>;
  monthlyRevenue(
    partnerId: string,
    periods: string[],
  ): Promise<Map<string, { commissionMinor: number; markupMinor: number }>>;
  invoices(partnerId: string, limit: number): Promise<InvoiceRow[]>;
  /** The fund and each customer's use of it this month, from the existing credit metering. */
  creditUsage(partner: PartnerRecord, now: Date): Promise<CreditUsage>;
  setCustomerLimit(partner: PartnerRecord, row: CustomerRow, limit: number | null): Promise<void>;
  setAllowedModels(partner: PartnerRecord, models: string[]): Promise<void>;
  setAutoTopup(
    partner: PartnerRecord,
    input: { enabled: boolean; thresholdCredits: number | null; amountMinor: number | null },
  ): Promise<void>;
  keyIssuedAt(partner: PartnerRecord): Promise<Date>;
  rotateKey(partner: PartnerRecord): Promise<{ key: string; prefix: string }>;
  setWebhookUrl(partner: PartnerRecord, url: string | null): Promise<void>;
  rotateTestKey(partner: PartnerRecord): Promise<{ key: string; prefix: string }>;
  setTestWebhookUrl(partner: PartnerRecord, url: string | null): Promise<void>;
  /** The partner's test customers, for the wipe; never a live one. */
  testTenants(
    partner: PartnerRecord,
  ): Promise<Array<{ organizationId: string; ownerUserId: string }>>;
  /** Removes test customers whose content is already deleted. */
  removeTestTenants(
    partner: PartnerRecord,
    tenants: ReadonlyArray<{ organizationId: string; ownerUserId: string }>,
  ): Promise<number>;
  /** Whether each alert is also emailed to the partner's people; the app always shows it. */
  alertEmailSettings(
    partner: PartnerRecord,
  ): Promise<Array<{ kind: PartnerAlertKind; email: boolean }>>;
  setAlertEmail(partner: PartnerRecord, kind: PartnerAlertKind, email: boolean): Promise<void>;
  /** The events the partner's system sent in the last day, and the latest ones. */
  events(partner: PartnerRecord, now: Date): Promise<PartnerConsoleEvents>;
  setTemplate(partner: PartnerRecord, template: PartnerTemplate | null): Promise<void>;
  audit(event: {
    partnerId: string;
    actorUserId: string | null;
    kind: AuditKind;
    tenantId?: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface PartnerConsoleDeps {
  store: PartnerConsoleStore;
  now(): Date;
  /** The public origin of the app, where a support session's address points. */
  webOrigin: string;
  /** A fresh unguessable one-use code. */
  newCode(): string;
  /** Deletes what a test customer's owner left behind (agents, computers, files); absent in tests. */
  deleteTenantContent?(ownerUserId: string): Promise<void>;
  /** Opens Rook's checkout for a top-up of the partner's fund; absent where nothing bills. */
  topupCheckout?(partner: PartnerRecord, amountMinor: number): Promise<{ url: string }>;
}

export type PartnerConsoleErrorCode = "not_found" | "invalid" | "conflict" | "refused";

/** A refusal the caller can act on; `reason` names why, for a person or an agent to read. */
export class PartnerConsoleError extends Error {
  constructor(
    readonly code: PartnerConsoleErrorCode,
    readonly reason: string = code,
  ) {
    super(reason);
    this.name = "PartnerConsoleError";
  }
}
