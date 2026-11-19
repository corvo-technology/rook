import { createHash, randomBytes } from "node:crypto";
import type { Actor, AgentCatalogLocale } from "@corvo/contracts";
import {
  agentCatalogLocale,
  PartnerSessionInput,
  PartnerTemplate,
  PartnerTenantInput,
  VERTICAL_IDS,
  verticalPartnerTemplate,
} from "@corvo/contracts";
import { PartnerAllowanceRefused, PartnerTenantModeMismatch } from "@corvo/db";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readBoundedBody } from "./http-body.js";
import type { PartnerContent } from "./partner-content.js";

export const PARTNER_MAX_BODY_BYTES = 256 * 1024;
export const PARTNER_ENTRY_CODE_TTL_MS = 60_000;
const MAX_KEY_LENGTH = 128;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;

interface TenantRow {
  id: string;
  organizationId: string;
  ownerUserId: string;
  state: string;
}

/** What a key may do; a partner with no scopes recorded keeps the pilot's single one. */
export function partnerHasScope(partner: { scopes?: string[] | null }, scope: string): boolean {
  return (partner.scopes ?? ["tenants:write"]).includes(scope);
}

export interface PartnerAuth {
  id: string;
  template?: unknown;
  scopes?: string[] | null;
  billingModel?: string;
  /** The key is the partner's test key: it only reaches test customers, and nothing it does costs. */
  testMode?: boolean;
}

export interface PartnerRouteDeps {
  webOrigin: string;
  now(): Date;
  /** Counts one request and says whether the partner is still within its limit. */
  allowRequest(partnerId: string): Promise<boolean>;
  /** The partner a key belongs to, or null for any key that is not usable. */
  authenticate(key: string): Promise<PartnerAuth | null>;
  provision(
    partner: { id: string; testMode?: boolean },
    input: { externalTenantId: string; name: string },
  ): Promise<{
    tenantId: string;
    organizationId: string;
    spaceId: string;
    ownerUserId: string;
    created: boolean;
  }>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(
    partnerId: string,
    externalTenantId: string,
    testMode?: boolean,
  ): Promise<TenantRow | null>;
  setState(
    partnerId: string,
    externalTenantId: string,
    state: "enabled" | "suspended",
    testMode?: boolean,
  ): Promise<boolean>;
  /**
   * The Chief every customer starts with, in front of the partner's agents. Safe to repeat. `name`
   * is the partner's own name for it; without one the Chief has its localized default.
   */
  ensureChief(
    actor: Actor,
    locale: AgentCatalogLocale,
    options?: { name?: string },
  ): Promise<unknown>;
  /** Stores what every new customer of the partner gets, or removes it with null. */
  setTemplate(partnerId: string, template: PartnerTemplate | null): Promise<void>;
  install(actor: Actor, partnerId: string, content: PartnerContent): Promise<unknown>;
  grantAllowance(
    tenant: { organizationId: string; partnerId: string; externalTenantId: string },
    input: { amountCents: number; period: string },
  ): Promise<unknown>;
  storeEntryCode(row: {
    codeHash: string;
    partnerId: string;
    tenantId: string;
    externalUserId: string;
    externalEmail: string | null;
    role: string | null;
    scope: Record<string, unknown> | null;
    expiresAt: Date;
  }): Promise<void>;
}

/** A whole template, a starter to begin from, or null to remove it. */
const TemplateBody = z.union([
  z.object({ template: PartnerTemplate.nullable() }).strict(),
  z.object({ vertical: z.enum(VERTICAL_IDS) }).strict(),
]);

/** The same answer whether a customer is missing or belongs to someone else. */
const notFound = (c: Context) => c.json({ error: "Not found" }, 404);

function currentPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The API a partner's own system calls to manage its customers and let their people in. */
export function mountPartnerRoutes(app: Hono, deps: PartnerRouteDeps): void {
  /** Resolves the calling partner, or the response that refuses the call. */
  const authorize = async (
    c: Context,
    scope = "tenants:write",
  ): Promise<PartnerAuth | Response> => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
    if (!partnerHasScope(partner, scope)) return c.json({ error: "scope" }, 403);
    if (!(await deps.allowRequest(partner.id))) return c.json({ error: "Too many requests" }, 429);
    return partner;
  };

  /** Reads a bounded JSON body, or the response that refuses it. */
  const readJson = async (c: Context): Promise<unknown | Response> => {
    const raw = await readBoundedBody(c.req.raw, PARTNER_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    try {
      return raw === "" ? {} : JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
  };

  app.get("/api/partner/v1/template", async (c) => {
    const partner = await authorize(c);
    if (partner instanceof Response) return partner;
    return c.json({ template: PartnerTemplate.safeParse(partner.template).data ?? null });
  });

  app.put("/api/partner/v1/template", async (c) => {
    const partner = await authorize(c);
    if (partner instanceof Response) return partner;
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = TemplateBody.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const template =
      "vertical" in parsed.data
        ? verticalPartnerTemplate(parsed.data.vertical)
        : parsed.data.template;
    await deps.setTemplate(partner.id, template);
    return c.json({ template });
  });

  app.put("/api/partner/v1/tenants/:externalTenantId", async (c) => {
    const partner = await authorize(c);
    if (partner instanceof Response) return partner;
    const externalTenantId = c.req.param("externalTenantId");
    if (!ID.test(externalTenantId)) return c.json({ error: "Invalid tenant id" }, 400);
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = PartnerTenantInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const input = parsed.data;
    // A commerce partner's credit comes from its customers' plans, not from a wallet.
    if (input.allowanceCents && partner.billingModel === "commerce") {
      return c.json({ error: "commerce_partner" }, 409);
    }

    let tenant: Awaited<ReturnType<PartnerRouteDeps["provision"]>>;
    try {
      tenant = await deps.provision(partner, { externalTenantId, name: input.name });
    } catch (error) {
      // The id belongs to a customer of the other mode; a key never reaches across.
      if (error instanceof PartnerTenantModeMismatch) return c.json({ error: "tenant_mode" }, 409);
      throw error;
    }
    // What the call names wins; what it leaves out comes from the partner's template.
    const template = PartnerTemplate.safeParse(partner.template).data;
    const connector =
      input.connector ??
      (template?.connector && input.connectorToken
        ? { ...template.connector, token: input.connectorToken }
        : undefined);
    const agents = input.agents ?? template?.agents ?? [];
    const owner = {
      spaceId: tenant.spaceId,
      userId: tenant.ownerUserId,
      email: "owner@partner.invalid",
      isDeploymentOwner: false,
    };
    const locale = agentCatalogLocale(input.locale ?? "en");
    if (template?.chiefName) await deps.ensureChief(owner, locale, { name: template.chiefName });
    else await deps.ensureChief(owner, locale);
    const routines = input.agents ? undefined : template?.routines;
    if (connector || agents.length > 0) {
      try {
        await deps.install(owner, partner.id, { connector, agents, routines });
      } catch (error) {
        // An address this deployment may not call is the partner's input to fix, not a fault.
        if ((error as { code?: unknown })?.code === "BAD_REQUEST") {
          return c.json({ error: "Invalid connector" }, 400);
        }
        throw error;
      }
    }
    if (input.state) {
      await deps.setState(partner.id, externalTenantId, input.state, partner.testMode === true);
    }
    // A test customer is never given credit: nothing it does is paid for.
    if (input.allowanceCents && !partner.testMode) {
      try {
        await deps.grantAllowance(
          { organizationId: tenant.organizationId, partnerId: partner.id, externalTenantId },
          {
            amountCents: input.allowanceCents,
            period: input.period ?? currentPeriod(deps.now()),
          },
        );
      } catch (error) {
        // The customer is set up either way; the partner fixes its credit or limit and calls again.
        if (error instanceof PartnerAllowanceRefused) {
          return error.reason === "wallet"
            ? c.json({ error: "wallet_insufficient", tenantId: tenant.tenantId }, 402)
            : c.json({ error: "allowance_limit", tenantId: tenant.tenantId }, 409);
        }
        throw error;
      }
    }
    return c.json({
      tenantId: tenant.tenantId,
      created: tenant.created,
      ...(partner.testMode ? { test: true } : {}),
    });
  });

  for (const [action, state] of [
    ["suspend", "suspended"],
    ["resume", "enabled"],
  ] as const) {
    app.post(`/api/partner/v1/tenants/:externalTenantId/${action}`, async (c) => {
      const partner = await authorize(c);
      if (partner instanceof Response) return partner;
      const found = await deps.setState(
        partner.id,
        c.req.param("externalTenantId"),
        state,
        partner.testMode === true,
      );
      return found ? c.json({ ok: true }) : notFound(c);
    });
  }

  app.post("/api/partner/v1/sessions", async (c) => {
    const partner = await authorize(c);
    if (partner instanceof Response) return partner;
    const json = await readJson(c);
    if (json instanceof Response) return json;
    const parsed = PartnerSessionInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const { externalTenantId, externalUserId, email, role, scope } = parsed.data;

    const tenant = await deps.findTenant(partner.id, externalTenantId, partner.testMode === true);
    if (tenant?.state !== "enabled") return notFound(c);

    const code = randomBytes(32).toString("base64url");
    const expiresAt = new Date(deps.now().getTime() + PARTNER_ENTRY_CODE_TTL_MS);
    await deps.storeEntryCode({
      codeHash: createHash("sha256").update(code).digest("hex"),
      partnerId: partner.id,
      tenantId: tenant.id,
      externalUserId,
      externalEmail: email ?? null,
      // Without a role the person is the customer's owner, as sessions were before roles.
      role: role ?? null,
      scope: scope ?? null,
      expiresAt,
    });
    const url = new URL("/api/partner/enter", deps.webOrigin);
    url.searchParams.set("code", code);
    return c.json({ url: url.toString(), code, expiresAt: expiresAt.toISOString() });
  });
}
