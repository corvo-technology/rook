import type { IdempotentOutcome, MarkupRule } from "@corvo/db";
import { markupItemId } from "@corvo/db";
import type {
  AuditKind,
  CustomerRow,
  InvoiceRow,
  MarkupChange,
  PartnerConsoleDeps,
  PartnerConsoleStore,
  PartnerRecord,
  RevenueEntryRow,
} from "./types.js";

export const NOW = new Date("2026-11-18T12:00:00Z");

export function partnerRecord(id: string, overrides: Partial<PartnerRecord> = {}): PartnerRecord {
  return {
    id,
    slug: `slug-${id}`,
    name: `Partner ${id}`,
    mode: "white_label",
    currency: "BRL",
    billingModel: "commerce",
    commissionBps: 2000,
    checkoutUrl: null,
    keyPrefix: `cpk_${id}`,
    webhookUrl: null,
    accent: null,
    chiefName: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

export function customerRow(id: string, overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    tenantId: id,
    externalTenantId: `ext-${id}`,
    organizationId: `org-of-${id}`,
    name: `Customer ${id}`,
    plan: "Team",
    planKey: "team",
    creditUsedPct: 10,
    creditRemaining: 18000,
    state: "active",
    since: new Date("2026-10-01T00:00:00Z"),
    lowCredit: false,
    connector: "ok",
    connectorCheckedAt: null,
    pastDueSince: null,
    subscription: null,
    ...overrides,
  };
}

export interface FakeData {
  /** Organizations that manage each partner. */
  members: Record<string, string[]>;
  partners: PartnerRecord[];
  customers: Record<string, CustomerRow[]>;
  revenue?: Record<string, RevenueEntryRow[]>;
  invoices?: Record<string, InvoiceRow[]>;
}

/** The same contract as the database store, in memory, recording every write for assertions. */
export function createFakeStore(data: FakeData) {
  const markups = new Map<string, Map<string, MarkupRule>>();
  const audit: Array<{
    partnerId: string;
    kind: AuditKind;
    actorUserId: string | null;
    tenantId?: string;
    detail: Record<string, unknown>;
  }> = [];
  const credits: Array<{ tenantId: string; amountMinor: number; key: string }> = [];
  const codes: Array<{ partnerId: string; tenantId: string; codeHash: string; expiresAt: Date }> =
    [];
  const idempotency = new Map<string, { hash: string; body: unknown }>();
  const limits = new Map<string, number>();
  const allowed: string[] = [];
  const autoTopup = {
    enabled: false,
    thresholdCredits: null as number | null,
    amountMinor: null as number | null,
  };
  const writes = { markups: 0, state: 0, key: 0, webhook: 0, checkout: 0 };

  const managed = (organizationId: string) =>
    data.partners.filter((partner) => data.members[partner.id]?.includes(organizationId));

  const store: PartnerConsoleStore = {
    listPartners: async (organizationId) => managed(organizationId),
    findPartner: async (organizationId, partnerId) =>
      managed(organizationId).find((partner) => partner.id === partnerId) ?? null,
    customerRows: async (partner) => data.customers[partner.id] ?? [],
    customerDetail: async (_partner, row) => ({
      agents: ["Chief"],
      runs30d: 12,
      planRemaining: row.creditRemaining,
      topupRemaining: 0,
      periodEnd: new Date("2026-12-01T00:00:00Z"),
    }),
    setTenantState: async (partner, row, state) => {
      writes.state += 1;
      const target = (data.customers[partner.id] ?? []).find((c) => c.tenantId === row.tenantId);
      if (target) target.state = state === "suspended" ? "paused" : "active";
    },
    addCredit: async (partner, row, input) => {
      credits.push({ tenantId: row.tenantId, amountMinor: input.amountMinor, key: input.key });
      const target = (data.customers[partner.id] ?? []).find((c) => c.tenantId === row.tenantId);
      if (target) target.creditRemaining += input.amountMinor;
    },
    createEntryCode: async (input) => {
      codes.push(input);
    },
    idempotent: async (partnerId, key, hash, run): Promise<IdempotentOutcome> => {
      const id = `${partnerId}/${key}`;
      const seen = idempotency.get(id);
      if (seen) {
        return seen.hash === hash
          ? { kind: "replay", status: 200, body: seen.body }
          : { kind: "conflict" };
      }
      const result = await run();
      idempotency.set(id, { hash, body: result.body });
      return { kind: "ran", ...result };
    },
    catalog: async (partner) => ({
      currency: partner.currency,
      plans: [
        { key: "team", name: "Team", baseMinor: 49900, creditMinor: 20000 },
        { key: "solo", name: "Solo", baseMinor: 2900, creditMinor: 1000 },
      ],
      packs: [{ key: "pack_s", name: "Small", baseMinor: 5000, creditMinor: 5000 }],
    }),
    markups: async (partnerId) => markups.get(partnerId) ?? new Map(),
    replaceMarkups: async (partnerId, changes: MarkupChange[]) => {
      writes.markups += 1;
      const current = markups.get(partnerId) ?? new Map<string, MarkupRule>();
      for (const change of changes) {
        const id = markupItemId(change.itemKind, change.itemKey);
        if (change.value === 0) current.delete(id);
        else current.set(id, { kind: change.kind, value: change.value });
      }
      markups.set(partnerId, current);
    },
    setCheckoutUrl: async (partner, url) => {
      writes.checkout += 1;
      partner.checkoutUrl = url;
    },
    revenueEntries: async (partnerId) => data.revenue?.[partnerId] ?? [],
    monthlyRevenue: async (partnerId, periods) => {
      const result = new Map<string, { commissionMinor: number; markupMinor: number }>();
      for (const entry of data.revenue?.[partnerId] ?? []) {
        const month = entry.createdAt.toISOString().slice(0, 7);
        if (!periods.includes(month)) continue;
        const sum = result.get(month) ?? { commissionMinor: 0, markupMinor: 0 };
        sum.commissionMinor += entry.partnerCommissionMinor;
        sum.markupMinor += entry.markupMinor;
        result.set(month, sum);
      }
      return result;
    },
    invoices: async (partnerId) => data.invoices?.[partnerId] ?? [],
    creditUsage: async (partner) => ({
      planCredits: 0,
      topupCredits: 5000,
      customers: (data.customers[partner.id] ?? []).map((row) => ({
        tenantId: row.tenantId,
        name: row.name,
        usedCredits: 120,
        limitCredits: limits.get(row.tenantId) ?? null,
        byResource: { "model-a": 100, other: 20 },
      })),
      autoTopup: { ...autoTopup },
      allowedModels: [...allowed],
    }),
    setCustomerLimit: async (_partner, row, limit) => {
      if (limit === null) limits.delete(row.tenantId);
      else limits.set(row.tenantId, limit);
    },
    setAllowedModels: async (_partner, models) => {
      allowed.splice(0, allowed.length, ...models);
    },
    setAutoTopup: async (_partner, input) => {
      Object.assign(autoTopup, input);
    },
    keyIssuedAt: async (partner) => partner.createdAt,
    rotateKey: async (partner) => {
      writes.key += 1;
      partner.keyPrefix = "cpk_NEWKEY00";
      return { key: "cpk_NEWKEY00.secret", prefix: partner.keyPrefix };
    },
    setWebhookUrl: async (partner, url) => {
      writes.webhook += 1;
      partner.webhookUrl = url;
    },
    audit: async (event) => {
      audit.push({ ...event, actorUserId: event.actorUserId });
    },
  };

  return { store, markups, audit, credits, codes, writes };
}

export function createDeps(store: PartnerConsoleStore): PartnerConsoleDeps {
  let counter = 0;
  return {
    store,
    now: () => NOW,
    webOrigin: "https://app.example.test",
    newCode: () => `code-${++counter}`,
  };
}
