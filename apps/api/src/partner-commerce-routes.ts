import {
  PartnerRefundInput,
  PartnerSubscriptionInput,
  PartnerTopupInput,
  PartnerUsageQuery,
} from "@corvo/contracts";
import type {
  CatalogView,
  CommerceBalance,
  CommercePartner,
  CommerceTenant,
  IdempotentOutcome,
  RefundInput,
  SubscriptionInput,
  TopupInput,
} from "@corvo/db";
import { CommerceError, requestHash } from "@corvo/db";
import type { Context, Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import type { PartnerAuth } from "./partner-routes.js";
import { PARTNER_MAX_BODY_BYTES, partnerHasScope } from "./partner-routes.js";

const MAX_KEY_LENGTH = 128;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;

/** The statuses of the refusals a money call can end in. */
const REFUSALS: Record<string, number> = {
  unknown_plan: 422,
  unknown_pack: 422,
  invalid_period: 422,
  stale_period: 409,
  tenant_suspended: 409,
  plan_inactive: 409,
  limit_exceeded: 409,
  refund_exceeds: 409,
  unknown_payment: 404,
  fx_unavailable: 503,
};

export interface CommercePartnerAuth extends PartnerAuth {
  currency: string;
  commissionBps: number;
  webhookUrl?: string | null;
}

interface Operation<T> {
  events: string[];
  body: T;
}

export interface PartnerCommerceDeps {
  now(): Date;
  allowRequest(partnerId: string): Promise<boolean>;
  authenticate(key: string): Promise<CommercePartnerAuth | null>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(partnerId: string, externalTenantId: string): Promise<CommerceTenant | null>;
  catalog(currency: string): Promise<CatalogView>;
  setSubscription(
    partner: CommercePartner,
    tenant: CommerceTenant,
    input: SubscriptionInput,
    now: Date,
  ): Promise<Operation<unknown>>;
  topup(
    partner: CommercePartner,
    tenant: CommerceTenant,
    input: TopupInput,
    now: Date,
  ): Promise<Operation<unknown>>;
  refund(
    partner: CommercePartner,
    tenant: CommerceTenant,
    input: RefundInput,
    now: Date,
  ): Promise<Operation<unknown>>;
  balance(partner: CommercePartner, tenant: CommerceTenant, now: Date): Promise<CommerceBalance>;
  usage(partner: CommercePartner, tenant: CommerceTenant, period: string): Promise<unknown>;
  idempotent(
    partnerId: string,
    key: string,
    hash: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<IdempotentOutcome>;
  /** Queues delivery of the notices a call made; a lost queue is caught by the periodic sweep. */
  notify(eventIds: string[]): Promise<void>;
}

const notFound = (c: Context) => c.json({ error: "Not found" }, 404);

/**
 * The commerce half of the partner API (docs/partner-commerce.md, section 5): catalog, plans,
 * top-ups, refunds, balance and usage. Only partners billed as "commerce" may call it; the key's
 * scopes decide whether it may read or write. Money calls need an Idempotency-Key.
 */
export function mountPartnerCommerceRoutes(app: Hono, deps: PartnerCommerceDeps): void {
  /** The calling partner, or the response that refuses the call: 401, 403 scope, 429, 409 wallet. */
  const guard = async (c: Context, scope: string): Promise<CommercePartnerAuth | Response> => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
    if (!partnerHasScope(partner, scope)) return c.json({ error: "scope" }, 403);
    if (!(await deps.allowRequest(partner.id))) return c.json({ error: "Too many requests" }, 429);
    if (partner.billingModel !== "commerce") {
      return c.json({ error: "not_commerce_partner" }, 409);
    }
    return partner;
  };

  const tenantOf = async (c: Context, partner: CommercePartnerAuth) => {
    const id = c.req.param("externalTenantId") ?? "";
    if (!ID.test(id)) return null;
    return deps.findTenant(partner.id, id);
  };

  const readJson = async (c: Context): Promise<unknown | Response> => {
    const raw = await readBoundedBody(c.req.raw, PARTNER_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    try {
      return raw === "" ? {} : JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
  };

  /** Runs a money call once per Idempotency-Key and answers as the key's first call did. */
  const money = async <T>(
    c: Context,
    partner: CommercePartnerAuth,
    _tenant: CommerceTenant,
    body: unknown,
    successStatus: number,
    operation: (now: Date, key: string) => Promise<Operation<T>>,
  ): Promise<Response> => {
    const key = c.req.header("idempotency-key") ?? "";
    if (!IDEMPOTENCY_KEY.test(key)) return c.json({ error: "idempotency_key_required" }, 400);
    let events: string[] = [];
    const outcome = await deps.idempotent(
      partner.id,
      key,
      requestHash(`${c.req.method} ${new URL(c.req.url).pathname}`, body),
      async () => {
        try {
          const done = await operation(deps.now(), key);
          events = done.events;
          return { status: successStatus, body: done.body };
        } catch (error) {
          if (error instanceof CommerceError) {
            return { status: REFUSALS[error.code] ?? 409, body: { error: error.code } };
          }
          throw error;
        }
      },
    );
    if (outcome.kind === "conflict") return c.json({ error: "idempotency_conflict" }, 409);
    if (outcome.kind === "in_progress") return c.json({ error: "idempotency_in_progress" }, 409);
    if (events.length > 0) await deps.notify(events).catch(() => undefined);
    return c.json(outcome.body as object, outcome.status as 200);
  };

  app.get("/api/partner/v1/catalog", async (c) => {
    const partner = await guard(c, "commerce:read");
    if (partner instanceof Response) return partner;
    const catalog = await deps.catalog(partner.currency);
    // Markups arrive with the partner console; until then the price to charge is the base.
    const priced = (item: CatalogView["plans"][number]) => ({
      key: item.key,
      baseMinor: item.baseMinor,
      markupMinor: 0,
      priceMinor: item.baseMinor,
      creditMinor: item.creditMinor,
    });
    return c.json({
      currency: catalog.currency,
      plans: catalog.plans.map(priced),
      packs: catalog.packs.map(priced),
    });
  });

  app.put("/api/partner/v1/tenants/:externalTenantId/subscription", async (c) => {
    const partner = await guard(c, "commerce:write");
    if (partner instanceof Response) return partner;
    const tenant = await tenantOf(c, partner);
    if (!tenant) return notFound(c);
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = PartnerSubscriptionInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const input = parsed.data;
    return money(c, partner, tenant, json, 200, (now, key) =>
      deps.setSubscription(
        partner,
        tenant,
        {
          plan: input.plan,
          status: input.status,
          currentPeriodStart: new Date(input.currentPeriodStart),
          currentPeriodEnd: new Date(input.currentPeriodEnd),
          chargedMinor: input.chargedMinor,
          externalPaymentId: input.externalPaymentId,
          idempotencyKey: key,
        },
        now,
      ),
    );
  });

  app.post("/api/partner/v1/tenants/:externalTenantId/topups", async (c) => {
    const partner = await guard(c, "commerce:write");
    if (partner instanceof Response) return partner;
    const tenant = await tenantOf(c, partner);
    if (!tenant) return notFound(c);
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = PartnerTopupInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    return money(c, partner, tenant, json, 201, (now, key) =>
      deps.topup(partner, tenant, { ...parsed.data, idempotencyKey: key }, now),
    );
  });

  app.post("/api/partner/v1/tenants/:externalTenantId/refunds", async (c) => {
    const partner = await guard(c, "commerce:write");
    if (partner instanceof Response) return partner;
    const tenant = await tenantOf(c, partner);
    if (!tenant) return notFound(c);
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = PartnerRefundInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    return money(c, partner, tenant, json, 201, (now, key) =>
      deps.refund(partner, tenant, { ...parsed.data, idempotencyKey: key }, now),
    );
  });

  app.get("/api/partner/v1/tenants/:externalTenantId/balance", async (c) => {
    const partner = await guard(c, "commerce:read");
    if (partner instanceof Response) return partner;
    const tenant = await tenantOf(c, partner);
    if (!tenant) return notFound(c);
    const balance = await deps.balance(partner, tenant, deps.now());
    return c.json({
      currency: balance.currency,
      period: balance.period,
      state: balance.state,
      plan: {
        grantedMinor: balance.plan.grantedMinor,
        usedMinor: balance.plan.usedMinor,
        remainingMinor: balance.plan.remainingMinor,
        expiresAt: balance.plan.expiresAt?.toISOString() ?? null,
      },
      topup: { remainingMinor: balance.topup.remainingMinor },
      remainingMinor: balance.remainingMinor,
      fxRate: balance.fxRate,
    });
  });

  app.get("/api/partner/v1/tenants/:externalTenantId/usage", async (c) => {
    const partner = await guard(c, "commerce:read");
    if (partner instanceof Response) return partner;
    const tenant = await tenantOf(c, partner);
    if (!tenant) return notFound(c);
    const query = PartnerUsageQuery.safeParse({ period: c.req.query("period") });
    if (!query.success) return c.json({ error: "Invalid request" }, 400);
    return c.json((await deps.usage(partner, tenant, query.data.period)) as object);
  });
}
