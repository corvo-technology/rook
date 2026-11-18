import type {
  PartnerConsoleCustomerDetailSchema,
  PartnerConsoleCustomerSchema,
  PartnerConsoleIntegrationSchema,
  PartnerConsoleOverviewSchema,
  PartnerConsolePartnerSchema,
  PartnerConsolePricingSchema,
  PartnerConsoleRevenueSchema,
  PartnerCreditsSchema,
  PartnerTemplate,
} from "@corvo/contracts";
import type { MarkupRule } from "@corvo/db";
import {
  isHttpsUrl,
  markupError,
  markupItemId,
  parseMarkupItemId,
  priceItem,
  requestHash,
  subscriptionPriceMinor,
} from "@corvo/db";
import type { z } from "zod";
import { hashEntryCode, PARTNER_ENTRY_PATH } from "../partner-entry.js";
import type { CustomerFilter } from "./format.js";
import {
  compareCustomers,
  decodeCursor,
  encodeCursor,
  isAfterCursor,
  lastPeriods,
  matchesFilter,
  PERIOD,
  periodOf,
  statementCsv,
} from "./format.js";
import type {
  CustomerRow,
  MarkupChange,
  PartnerConsoleDeps,
  PartnerRecord,
  PartnerScope,
} from "./types.js";
import { PartnerConsoleError } from "./types.js";

export type PartnerSummary = z.infer<typeof PartnerConsolePartnerSchema>;
export type OverviewResult = z.infer<typeof PartnerConsoleOverviewSchema>;
export type CustomerItem = z.infer<typeof PartnerConsoleCustomerSchema>;
export type CustomerDetail = z.infer<typeof PartnerConsoleCustomerDetailSchema>;
export type PricingResult = z.infer<typeof PartnerConsolePricingSchema>;
export type RevenueResult = z.infer<typeof PartnerConsoleRevenueSchema>;
export type CreditsResult = z.infer<typeof PartnerCreditsSchema>;
export type IntegrationResult = z.infer<typeof PartnerConsoleIntegrationSchema>;

/** How long a support session's address works: long enough to click, short enough to be useless later. */
export const SUPPORT_SESSION_TTL_MS = 60_000;
const ATTENTION_LIMIT = 20;
const MONTHS_SHOWN = 6;
const INVOICES_SHOWN = 12;
const INVOICE_NOTICE_DAYS = 30;

/**
 * The partner the organization manages, or the same answer as for one that does not exist. Every
 * function below starts here, so no read or write can reach another organization's partner.
 */
export async function requirePartner(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  partnerId: string,
): Promise<PartnerRecord> {
  const partner = await deps.store.findPartner(scope.organizationId, partnerId);
  if (!partner) throw new PartnerConsoleError("not_found");
  return partner;
}

const toSummary = (partner: PartnerRecord): PartnerSummary => ({
  id: partner.id,
  slug: partner.slug,
  name: partner.name,
  mode: partner.mode,
  currency: partner.currency,
  accent: partner.accent,
  chiefName: partner.chiefName,
});

const toItem = (row: CustomerRow): CustomerItem => ({
  tenantId: row.tenantId,
  name: row.name,
  plan: row.plan,
  creditUsedPct: row.creditUsedPct,
  creditRemaining: row.creditRemaining,
  state: row.state,
  since: row.since.toISOString(),
});

export async function listPartners(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
): Promise<PartnerSummary[]> {
  return (await deps.store.listPartners(scope.organizationId)).map(toSummary);
}

async function requireCustomer(
  deps: PartnerConsoleDeps,
  partner: PartnerRecord,
  tenantId: string,
): Promise<CustomerRow> {
  // Rows are the partner's own customers only, so a tenant id of another partner finds nothing.
  const row = (await deps.store.customerRows(partner, deps.now())).find(
    (candidate) => candidate.tenantId === tenantId,
  );
  if (!row) throw new PartnerConsoleError("not_found");
  return row;
}

export async function getOverview(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; period?: string },
): Promise<OverviewResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const now = deps.now();
  const period = input.period ?? periodOf(now);
  if (!PERIOD.test(period)) throw new PartnerConsoleError("invalid", "period");
  const months = lastPeriods(period, MONTHS_SHOWN);
  const [rows, revenue, invoices] = await Promise.all([
    deps.store.customerRows(partner, now),
    deps.store.monthlyRevenue(partner.id, months),
    deps.store.invoices(partner.id, INVOICES_SHOWN),
  ]);
  const earned = (month: string) => {
    const entry = revenue.get(month);
    return { commission: entry?.commissionMinor ?? 0, markup: entry?.markupMinor ?? 0 };
  };
  const current = earned(period);
  const attention: OverviewResult["attention"] = [];
  for (const row of rows) {
    const base = { tenantId: row.tenantId, tenantName: row.name };
    if (row.state === "past_due") {
      attention.push({
        ...base,
        kind: "past_due",
        detail: "past_due",
        at: (row.pastDueSince ?? now).toISOString(),
      });
    }
    if (matchesFilter(row, "credit_low")) {
      attention.push({
        ...base,
        kind: "credit_low",
        detail: row.creditUsedPct === null ? "low" : `${row.creditUsedPct}%`,
        at: now.toISOString(),
      });
    }
    if (row.connector === "down" && row.state !== "paused") {
      attention.push({
        ...base,
        kind: "connector_down",
        detail: "down",
        at: (row.connectorCheckedAt ?? now).toISOString(),
      });
    }
  }
  const since = now.getTime() - INVOICE_NOTICE_DAYS * 86_400_000;
  for (const invoice of invoices) {
    if (invoice.state === "issued" && invoice.issuedAt && invoice.issuedAt.getTime() >= since) {
      attention.push({
        kind: "invoice_issued",
        detail: invoice.period,
        at: invoice.issuedAt.toISOString(),
      });
    }
  }
  attention.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    currency: partner.currency,
    revenue: {
      total: current.commission + current.markup,
      commission: current.commission,
      markup: current.markup,
    },
    activeCustomers: rows.filter((row) => row.state === "active").length,
    newCustomers: rows.filter((row) => periodOf(row.since) === period).length,
    creditLow: rows.filter((row) => matchesFilter(row, "credit_low")).length,
    pastDue: rows.filter((row) => row.state === "past_due").length,
    monthly: months.map((month) => {
      const value = earned(month);
      return { month, total: value.commission + value.markup };
    }),
    attention: attention.slice(0, ATTENTION_LIMIT),
  };
}

export async function listCustomers(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: {
    partnerId: string;
    filter?: CustomerFilter;
    q?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<{ items: CustomerItem[]; next: string | null }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const cursor = input.cursor ? decodeCursor(input.cursor) : null;
  if (input.cursor && !cursor) throw new PartnerConsoleError("invalid", "cursor");
  const query = input.q?.trim().toLowerCase() ?? "";
  const matching = (await deps.store.customerRows(partner, deps.now()))
    .filter((row) => matchesFilter(row, input.filter ?? "all"))
    .filter((row) => query === "" || row.name.toLowerCase().includes(query))
    .sort(compareCustomers)
    .filter((row) => !cursor || isAfterCursor(row, cursor));
  const page = matching.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toItem),
    next: matching.length > limit && last ? encodeCursor(last) : null,
  };
}

export async function getCustomer(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; tenantId: string },
): Promise<CustomerDetail> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const now = deps.now();
  const row = await requireCustomer(deps, partner, input.tenantId);
  const [extras, pricing] = await Promise.all([
    deps.store.customerDetail(partner, row, now),
    row.subscription && row.planKey ? currentPlanFinal(deps, partner, row.planKey) : null,
  ]);
  return {
    ...toItem(row),
    agents: extras.agents,
    connector: row.connector,
    runs30d: extras.runs30d,
    balance: {
      currency: partner.currency,
      remaining: row.creditRemaining,
      planRemaining: extras.planRemaining,
      topupRemaining: extras.topupRemaining,
      periodEnd: extras.periodEnd?.toISOString() ?? null,
    },
    priceMinor: row.subscription
      ? subscriptionPriceMinor(row.subscription, pricing ?? 0, now)
      : null,
  };
}

async function currentPlanFinal(
  deps: PartnerConsoleDeps,
  partner: PartnerRecord,
  planKey: string,
): Promise<number | null> {
  const [catalog, markups] = await Promise.all([
    deps.store.catalog(partner),
    deps.store.markups(partner.id),
  ]);
  const plan = catalog.plans.find((item) => item.key === planKey);
  return plan
    ? priceItem(plan.baseMinor, partner.commissionBps, markups.get(markupItemId("plan", planKey)))
        .finalMinor
    : null;
}

export interface CustomerActionInput {
  partnerId: string;
  tenantId: string;
  action: "pause" | "resume" | "add_credit";
  amountMinor?: number;
  idempotencyKey: string;
}

/**
 * Pauses, resumes or gives credit to one customer. The same idempotency key and request acts once
 * and answers as the first call did (`replayed`); another request under the key is a conflict.
 * Every change is audited with who made it.
 */
export async function runCustomerAction(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: CustomerActionInput,
): Promise<{ state: CustomerRow["state"]; creditRemaining: number; replayed: boolean }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if ((input.action === "add_credit") !== (input.amountMinor !== undefined)) {
    throw new PartnerConsoleError("invalid", "amountMinor");
  }
  if (
    input.amountMinor !== undefined &&
    (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
  ) {
    throw new PartnerConsoleError("invalid", "amountMinor");
  }
  const row = await requireCustomer(deps, partner, input.tenantId);
  const actorUserId = scope.actorUserId ?? null;
  const outcome = await deps.store.idempotent(
    partner.id,
    `console:${input.idempotencyKey}`,
    requestHash("console.customerAction", {
      tenantId: row.tenantId,
      action: input.action,
      amountMinor: input.amountMinor,
    }),
    async () => {
      const now = deps.now();
      if (input.action === "add_credit") {
        if (row.state === "paused") throw new PartnerConsoleError("refused", "tenant_suspended");
        await deps.store.addCredit(
          partner,
          row,
          { amountMinor: input.amountMinor as number, key: input.idempotencyKey },
          now,
        );
        await deps.store.audit({
          partnerId: partner.id,
          actorUserId,
          kind: "customer.credit_added",
          tenantId: row.tenantId,
          detail: { amountMinor: input.amountMinor, currency: partner.currency },
        });
      } else {
        const pause = input.action === "pause";
        await deps.store.setTenantState(partner, row, pause ? "suspended" : "enabled");
        await deps.store.audit({
          partnerId: partner.id,
          actorUserId,
          kind: pause ? "customer.paused" : "customer.resumed",
          tenantId: row.tenantId,
          detail: {},
        });
      }
      const after = (await deps.store.customerRows(partner, now)).find(
        (candidate) => candidate.tenantId === row.tenantId,
      );
      return {
        status: 200,
        body: { state: after?.state ?? row.state, creditRemaining: after?.creditRemaining ?? 0 },
      };
    },
  );
  if (outcome.kind === "conflict")
    throw new PartnerConsoleError("conflict", "idempotency_conflict");
  if (outcome.kind === "in_progress") {
    throw new PartnerConsoleError("conflict", "idempotency_in_progress");
  }
  const body = outcome.body as { state: CustomerRow["state"]; creditRemaining: number };
  return {
    state: body.state,
    creditRemaining: body.creditRemaining,
    replayed: outcome.kind === "replay",
  };
}

/**
 * A one-use address that opens the customer's workspace as the customer ("open as support"). It
 * works once and for a minute, and the audit trail records who asked.
 */
export async function openSupportSession(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; tenantId: string },
): Promise<{ url: string; expiresAt: string }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const row = await requireCustomer(deps, partner, input.tenantId);
  if (row.state === "paused") throw new PartnerConsoleError("refused", "tenant_suspended");
  const code = deps.newCode();
  const expiresAt = new Date(deps.now().getTime() + SUPPORT_SESSION_TTL_MS);
  const actorUserId = scope.actorUserId ?? null;
  await deps.store.createEntryCode({
    partnerId: partner.id,
    tenantId: row.tenantId,
    codeHash: hashEntryCode(code),
    actorUserId,
    expiresAt,
  });
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId,
    kind: "support.session_opened",
    tenantId: row.tenantId,
    detail: {},
  });
  const url = new URL(PARTNER_ENTRY_PATH, deps.webOrigin);
  url.searchParams.set("code", code);
  return { url: url.toString(), expiresAt: expiresAt.toISOString() };
}

/** Markup and commission belong to white-label and referral partners; embedded ones use credits. */
function requireReferralModel(partner: PartnerRecord): void {
  if (partner.mode === "embedded") throw new PartnerConsoleError("refused", "credits_model");
}

export async function getPricing(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<PricingResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  requireReferralModel(partner);
  return buildPricing(deps, partner);
}

async function buildPricing(
  deps: PartnerConsoleDeps,
  partner: PartnerRecord,
): Promise<PricingResult> {
  const [catalog, markups] = await Promise.all([
    deps.store.catalog(partner),
    deps.store.markups(partner.id),
  ]);
  const price = (kind: "plan" | "pack") => (item: (typeof catalog.plans)[number]) => {
    const itemId = markupItemId(kind, item.key);
    const rule = markups.get(itemId);
    const priced = priceItem(item.baseMinor, partner.commissionBps, rule);
    return {
      itemId,
      planId: item.key,
      name: item.name,
      creditMinor: item.creditMinor,
      baseMinor: priced.baseMinor,
      commissionMinor: priced.commissionMinor,
      markup: rule ?? { kind: "fixed" as const, value: 0 },
      markupMinor: priced.markupMinor,
      finalMinor: priced.finalMinor,
    };
  };
  return {
    currency: partner.currency,
    commissionBps: partner.commissionBps,
    checkoutUrl: partner.checkoutUrl,
    plans: catalog.plans.map(price("plan")),
    packs: catalog.packs.map(price("pack")),
  };
}

/**
 * Sets markups (fixed minor units or percent in basis points; zero removes one) and the checkout
 * address. Commission, mode, country and currency are Rook's to change and have no input here. A
 * markup affects new charges only: a subscription keeps the price it was sold at until it renews.
 */
export async function setPricing(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: {
    partnerId: string;
    checkoutUrl?: string | null;
    markups: Array<{ itemId: string; kind: MarkupRule["kind"]; value: number }>;
  },
): Promise<PricingResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  requireReferralModel(partner);
  const catalog = await deps.store.catalog(partner);
  const changes: MarkupChange[] = [];
  const seen = new Set<string>();
  for (const markup of input.markups) {
    const parsed = parseMarkupItemId(markup.itemId);
    if (!parsed || seen.has(markup.itemId)) throw new PartnerConsoleError("invalid", "itemId");
    seen.add(markup.itemId);
    const item = (parsed.itemKind === "plan" ? catalog.plans : catalog.packs).find(
      (candidate) => candidate.key === parsed.itemKey,
    );
    if (!item) throw new PartnerConsoleError("invalid", "itemId");
    const problem = markupError(item.baseMinor, markup);
    if (problem) throw new PartnerConsoleError("invalid", `markup_${problem}`);
    changes.push({ ...parsed, kind: markup.kind, value: markup.value });
  }
  const checkoutUrl = input.checkoutUrl === "" ? null : input.checkoutUrl;
  if (checkoutUrl && !isHttpsUrl(checkoutUrl))
    throw new PartnerConsoleError("invalid", "checkoutUrl");
  const checkoutUrlChanged = checkoutUrl !== undefined && checkoutUrl !== partner.checkoutUrl;
  if (changes.length > 0) await deps.store.replaceMarkups(partner.id, changes);
  if (checkoutUrlChanged) await deps.store.setCheckoutUrl(partner, checkoutUrl ?? null);
  if (changes.length > 0 || checkoutUrl !== undefined) {
    await deps.store.audit({
      partnerId: partner.id,
      actorUserId: scope.actorUserId ?? null,
      kind: "pricing.changed",
      detail: {
        markups: changes.map((change) => ({
          item: markupItemId(change.itemKind, change.itemKey),
          kind: change.kind,
          value: change.value,
        })),
        checkoutUrlChanged,
      },
    });
  }
  const updated = await requirePartner(deps, scope, partner.id);
  return buildPricing(deps, updated);
}

export async function getRevenue(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; period: string },
): Promise<RevenueResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if (!PERIOD.test(input.period)) throw new PartnerConsoleError("invalid", "period");
  const [entries, invoices] = await Promise.all([
    deps.store.revenueEntries(partner.id, input.period),
    deps.store.invoices(partner.id, INVOICES_SHOWN),
  ]);
  const lines = entries.map((entry) => ({
    id: entry.id,
    at: entry.createdAt.toISOString(),
    tenantId: entry.tenantId,
    tenantName: entry.tenantName,
    kind: entry.kind as RevenueResult["lines"][number]["kind"],
    baseMinor: entry.baseMinor,
    rookShareMinor: entry.rookShareMinor,
    commissionMinor: entry.partnerCommissionMinor,
    markupMinor: entry.markupMinor,
    paidMinor: entry.paidMinor,
  }));
  const sum = (pick: (line: (typeof lines)[number]) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const commissionMinor = sum((line) => line.commissionMinor);
  const markupMinor = sum((line) => line.markupMinor);
  return {
    currency: partner.currency,
    period: input.period,
    lines,
    totals: {
      baseMinor: sum((line) => line.baseMinor),
      rookShareMinor: sum((line) => line.rookShareMinor),
      commissionMinor,
      markupMinor,
      paidMinor: sum((line) => line.paidMinor),
      partnerMinor: commissionMinor + markupMinor,
    },
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      period: invoice.period,
      state: invoice.state,
      totalMinor: invoice.totalMinor,
    })),
  };
}

/** The month's statement as CSV, as a `data:` address a download link can use. */
export async function getRevenueCsv(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; period: string },
): Promise<{ url: string; filename: string }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const revenue = await getRevenue(deps, scope, input);
  const csv = statementCsv(revenue.lines);
  return {
    url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
    filename: `${partner.slug}-${input.period}.csv`,
  };
}

export async function getIntegration(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<IntegrationResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  return {
    keys: [
      {
        prefix: partner.keyPrefix,
        createdAt: (await deps.store.keyIssuedAt(partner)).toISOString(),
      },
    ],
    webhook: { url: partner.webhookUrl, enabled: partner.webhookUrl !== null },
    docsUrl: new URL("/api/partner/v1", deps.webOrigin).toString(),
  };
}

/** Replaces the partner's key: the old one stops working now and the new one is returned once. */
export async function rotateIntegrationKey(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<{ key: string; prefix: string }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const issued = await deps.store.rotateKey(partner);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "key.rotated",
    detail: { prefix: issued.prefix },
  });
  return issued;
}

/** What every new customer of the partner gets: agents, connector, Chief name. */
export async function getTemplate(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<{ template: PartnerTemplate | null }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  return { template: partner.template };
}

/** Replaces the template, or removes it with null. The shape is checked by the contract. */
export async function setTemplate(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; template: PartnerTemplate | null },
): Promise<{ template: PartnerTemplate | null }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  await deps.store.setTemplate(partner, input.template);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "template.changed",
    detail: { agents: input.template?.agents.length ?? 0, removed: input.template === null },
  });
  return { template: input.template };
}

export async function setIntegrationWebhook(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; url: string | null },
): Promise<{ url: string | null; enabled: boolean }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const url = input.url === "" ? null : input.url;
  if (url !== null && (!isHttpsUrl(url) || url.includes("{"))) {
    throw new PartnerConsoleError("invalid", "url");
  }
  await deps.store.setWebhookUrl(partner, url);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "webhook.changed",
    detail: { enabled: url !== null },
  });
  return { url, enabled: url !== null };
}

/** Embedded partners only: the fund, the plan and each customer's use, in credits. */
export async function getCredits(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<CreditsResult> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if (partner.mode !== "embedded") throw new PartnerConsoleError("refused", "referral_model");
  const usage = await deps.store.creditUsage(partner, deps.now());
  return {
    currency: partner.currency,
    plan:
      usage.plan && usage.plan.status === "active"
        ? {
            name: usage.plan.tierKey,
            priceMinor: usage.plan.priceMinor,
            includedCredits: usage.plan.includedCredits,
            periodEnd: usage.plan.periodEnd.toISOString(),
          }
        : null,
    balance: { planCredits: usage.planCredits, topupCredits: usage.topupCredits },
    autoTopup: usage.autoTopup,
    allowedModels: usage.allowedModels,
    customers: usage.customers,
  };
}

/** A monthly cap on one customer's credits; null removes it. */
export async function setCustomerCreditLimit(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; tenantId: string; limitCredits: number | null },
): Promise<{ limitCredits: number | null }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if (
    input.limitCredits !== null &&
    (!Number.isSafeInteger(input.limitCredits) || input.limitCredits <= 0)
  ) {
    throw new PartnerConsoleError("invalid", "limitCredits");
  }
  const row = await requireCustomer(deps, partner, input.tenantId);
  await deps.store.setCustomerLimit(partner, row, input.limitCredits);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "credit.limit_changed",
    tenantId: row.tenantId,
    detail: { limitCredits: input.limitCredits },
  });
  return { limitCredits: input.limitCredits };
}

/** Limits the Rook-provided models customers may use; a customer's own connections are never limited. */
export async function setAllowedModels(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; models: string[] },
): Promise<{ models: string[] }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  const models = [...new Set(input.models.map((model) => model.trim()).filter(Boolean))].sort();
  await deps.store.setAllowedModels(partner, models);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "credit.models_changed",
    detail: { count: models.length },
  });
  return { models };
}

export async function setAutoTopup(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: {
    partnerId: string;
    enabled: boolean;
    thresholdCredits: number | null;
    amountMinor: number | null;
  },
): Promise<{ ok: true }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if (input.enabled && (input.thresholdCredits === null || input.amountMinor === null)) {
    throw new PartnerConsoleError("invalid", "autoTopup");
  }
  await deps.store.setAutoTopup(partner, {
    enabled: input.enabled,
    thresholdCredits: input.thresholdCredits,
    amountMinor: input.amountMinor,
  });
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "credit.autotopup_changed",
    detail: {
      enabled: input.enabled,
      thresholdCredits: input.thresholdCredits,
      amountMinor: input.amountMinor,
    },
  });
  return { ok: true };
}

/** Starts a top-up through Rook's checkout. The credit arrives when the payment settles. */
export async function startTopup(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string; amountMinor: number },
): Promise<{ url: string }> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new PartnerConsoleError("invalid", "amountMinor");
  }
  if (!deps.topupCheckout) throw new PartnerConsoleError("refused", "billing_unavailable");
  const checkout = await deps.topupCheckout(partner, input.amountMinor);
  await deps.store.audit({
    partnerId: partner.id,
    actorUserId: scope.actorUserId ?? null,
    kind: "credit.topup_started",
    detail: { amountMinor: input.amountMinor, currency: partner.currency },
  });
  return checkout;
}

/** What the partner has paid Rook, newest period first. */
export async function listInvoices(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  input: { partnerId: string },
): Promise<
  Array<{
    id: string;
    period: string;
    state: "draft" | "issued" | "paid" | "void";
    totalMinor: number;
  }>
> {
  const partner = await requirePartner(deps, scope, input.partnerId);
  return (await deps.store.invoices(partner.id, INVOICES_SHOWN)).map((invoice) => ({
    id: invoice.id,
    period: invoice.period,
    state: invoice.state,
    totalMinor: invoice.totalMinor,
  }));
}
