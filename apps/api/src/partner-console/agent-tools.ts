import type { PartnerChoice, PartnerToolName, PartnerToolsPort } from "@corvo/adapters";
import type { PrismaClient } from "@corvo/db";
import { runAsSystem } from "@corvo/db";
import { createPrismaPartnerConsoleStore } from "./prisma-store.js";
import {
  getCredits,
  getCustomer,
  getOverview,
  listCustomers,
  listInvoices,
  listPartners,
  runCustomerAction,
  setCustomerCreditLimit,
} from "./service.js";
import type { PartnerConsoleDeps, PartnerRecord, PartnerScope } from "./types.js";
import { PartnerConsoleError } from "./types.js";

/** A customer is "near" its monthly limit from here on. */
const NEAR_LIMIT_PCT = 80;
/** The fund is "running out" when this many days of this month's pace would use it up. */
const FUND_WARNING_DAYS = 7;

export interface PartnerToolsPortOptions {
  deps: PartnerConsoleDeps;
  /** The organization that owns a space; null for a space that does not exist. */
  organizationOf(spaceId: string): Promise<string | null>;
}

/**
 * The agents' view of the partner console: thin wrappers over the same service functions the
 * console's routes call, so scoping, validation, idempotency and the audit trail are one code
 * path. Everything returned is numbers, states and names; nothing a customer wrote or said.
 */
export function createPartnerToolsPort(options: PartnerToolsPortOptions): PartnerToolsPort {
  const { deps } = options;

  async function scopeOf(spaceId: string, userId: string): Promise<PartnerScope | null> {
    const organizationId = await options.organizationOf(spaceId);
    return organizationId ? { organizationId, actorUserId: userId } : null;
  }

  async function partnersOf(spaceId: string): Promise<PartnerChoice[]> {
    const scope = await scopeOf(spaceId, "");
    if (!scope) return [];
    return (await listPartners(deps, scope)).map(({ id, slug, name }) => ({ id, slug, name }));
  }

  return {
    partners: partnersOf,
    async run(call) {
      const scope = await scopeOf(call.spaceId, call.userId);
      if (!scope) throw new Error("Not found");
      try {
        return await runTool(
          deps,
          scope,
          call.partnerId,
          call.tool,
          call.args,
          call.idempotencyKey,
        );
      } catch (error) {
        if (!(error instanceof PartnerConsoleError)) throw error;
        throw new Error(error.code === "not_found" ? "Not found" : error.reason);
      }
    },
  };
}

/**
 * The port over the database, for the API and the worker alike. An agent never signs a customer
 * in or opens a checkout, so the parts of the console's dependencies that do that are absent.
 */
export function createPrismaPartnerToolsPort(prisma: PrismaClient): PartnerToolsPort {
  return createPartnerToolsPort({
    deps: {
      store: createPrismaPartnerConsoleStore(prisma),
      now: () => new Date(),
      webOrigin: "",
      newCode: () => {
        throw new Error("Agents do not open support sessions");
      },
    },
    organizationOf: (spaceId) =>
      runAsSystem("partner tools organization", async () => {
        const space = await prisma.space.findUnique({
          where: { id: spaceId },
          select: { organizationId: true },
        });
        return space?.organizationId ?? null;
      }),
  });
}

type Args = Record<string, unknown>;

/** The customer an agent named, by id or by exact name, among this partner's customers only. */
async function resolveCustomer(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  partnerId: string,
  reference: string,
): Promise<string> {
  try {
    await getCustomer(deps, scope, { partnerId, tenantId: reference });
    return reference;
  } catch (error) {
    if (!(error instanceof PartnerConsoleError) || error.code !== "not_found") throw error;
  }
  const { items } = await listCustomers(deps, scope, { partnerId, q: reference, limit: 100 });
  const named = items.filter((item) => item.name.toLowerCase() === reference.toLowerCase());
  if (named.length === 1) return named[0]!.tenantId;
  throw new Error(
    named.length > 1
      ? "More than one customer has that name; use the id from partner_list_customers"
      : "Not found",
  );
}

async function runTool(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  partnerId: string,
  tool: PartnerToolName,
  args: Args,
  idempotencyKey: string,
): Promise<unknown> {
  const partner = (await deps.store.listPartners(scope.organizationId)).find(
    (entry) => entry.id === partnerId,
  );
  if (!partner) throw new PartnerConsoleError("not_found");
  const customerRef = typeof args.customer === "string" ? args.customer : "";
  switch (tool) {
    case "list_customers": {
      const limit = Number(args.limit ?? 25);
      const { items, next } = await listCustomers(deps, scope, {
        partnerId,
        filter: args.filter as "all" | "credit_low" | "past_due" | "paused",
        q: typeof args.q === "string" ? args.q : undefined,
        limit,
      });
      return {
        currency: partner.currency,
        customers: items.map((item) => ({
          id: item.tenantId,
          name: item.name,
          plan: item.plan,
          state: item.state,
          credit_used_pct: item.creditUsedPct,
          credit_remaining: item.creditRemaining,
          since: item.since,
        })),
        more: next !== null,
      };
    }
    case "customer_usage": {
      const tenantId = await resolveCustomer(deps, scope, partnerId, customerRef);
      const detail = await getCustomer(deps, scope, { partnerId, tenantId });
      const credits =
        partner.mode === "embedded"
          ? (await getCredits(deps, scope, { partnerId })).customers.find(
              (entry) => entry.tenantId === tenantId,
            )
          : undefined;
      return {
        currency: partner.currency,
        customer: { id: detail.tenantId, name: detail.name, since: detail.since },
        plan: detail.plan,
        state: detail.state,
        connector: detail.connector,
        credit_used_pct: detail.creditUsedPct,
        credit_remaining: detail.balance.remaining,
        plan_remaining: detail.balance.planRemaining,
        topup_remaining: detail.balance.topupRemaining,
        period_end: detail.balance.periodEnd,
        runs_30d: detail.runs30d,
        ...(credits
          ? {
              credits_used: credits.usedCredits,
              credit_limit: credits.limitCredits,
              credits_by_resource: credits.byResource,
            }
          : {}),
      };
    }
    case "attention":
      return attention(deps, scope, partner);
    case "revenue_summary":
      return revenueSummary(
        deps,
        scope,
        partner,
        typeof args.period === "string" ? args.period : undefined,
      );
    case "invoices":
      return {
        currency: partner.currency,
        invoices: await listInvoices(deps, scope, { partnerId }),
      };
    case "add_credit":
    case "pause_customer":
    case "resume_customer": {
      const tenantId = await resolveCustomer(deps, scope, partnerId, customerRef);
      const result = await runCustomerAction(deps, scope, {
        partnerId,
        tenantId,
        action:
          tool === "add_credit" ? "add_credit" : tool === "pause_customer" ? "pause" : "resume",
        amountMinor: tool === "add_credit" ? Number(args.amount_minor) : undefined,
        idempotencyKey,
      });
      return {
        currency: partner.currency,
        customer: tenantId,
        state: result.state,
        credit_remaining: result.creditRemaining,
        already_done: result.replayed,
      };
    }
    case "set_customer_limit": {
      const tenantId = await resolveCustomer(deps, scope, partnerId, customerRef);
      const limit = args.limit_credits === null ? null : Number(args.limit_credits);
      const result = await setCustomerCreditLimit(deps, scope, {
        partnerId,
        tenantId,
        limitCredits: limit,
      });
      return { customer: tenantId, credit_limit: result.limitCredits };
    }
  }
}

async function attention(deps: PartnerConsoleDeps, scope: PartnerScope, partner: PartnerRecord) {
  const overview = await getOverview(deps, scope, { partnerId: partner.id });
  const items: Array<{ kind: string; customer?: { id: string; name: string }; detail: string }> =
    overview.attention.map((entry) => ({
      kind: entry.kind,
      ...(entry.tenantId ? { customer: { id: entry.tenantId, name: entry.tenantName ?? "" } } : {}),
      detail: entry.detail,
    }));
  if (partner.mode === "embedded") {
    const credits = await getCredits(deps, scope, { partnerId: partner.id });
    for (const entry of credits.customers) {
      if (entry.limitCredits && (entry.usedCredits / entry.limitCredits) * 100 >= NEAR_LIMIT_PCT) {
        items.push({
          kind: "near_limit",
          customer: { id: entry.tenantId, name: entry.name },
          detail: `${Math.round((entry.usedCredits / entry.limitCredits) * 100)}%`,
        });
      }
    }
    const remaining = credits.balance.planCredits + credits.balance.topupCredits;
    const used = credits.customers.reduce((sum, entry) => sum + entry.usedCredits, 0);
    const perDay = used / deps.now().getUTCDate();
    if (perDay > 0 && remaining / perDay <= FUND_WARNING_DAYS) {
      items.push({ kind: "fund_running_out", detail: `${Math.floor(remaining / perDay)} days` });
    }
  }
  return { currency: partner.currency, attention: items };
}

async function revenueSummary(
  deps: PartnerConsoleDeps,
  scope: PartnerScope,
  partner: PartnerRecord,
  period: string | undefined,
) {
  const overview = await getOverview(deps, scope, { partnerId: partner.id, period });
  const customers = { active: overview.activeCustomers, new: overview.newCustomers };
  if (partner.mode === "embedded") {
    // Embedded partners pay Rook, not the other way round: the fund, the plan and the invoices.
    const credits = await getCredits(deps, scope, { partnerId: partner.id });
    return {
      mode: "embedded",
      currency: partner.currency,
      customers,
      fund: {
        plan_credits: credits.balance.planCredits,
        topup_credits: credits.balance.topupCredits,
      },
      plan: credits.plan,
      auto_topup: credits.autoTopup,
      invoices: await listInvoices(deps, scope, { partnerId: partner.id }),
    };
  }
  return {
    mode: partner.mode,
    currency: partner.currency,
    customers,
    revenue: overview.revenue,
    monthly: overview.monthly,
  };
}
