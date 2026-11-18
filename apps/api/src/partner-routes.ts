import { createHash, randomBytes } from "node:crypto";
import type { Actor, AgentCatalogLocale } from "@corvo/contracts";
import {
  agentCatalogLocale,
  PartnerSessionInput,
  PartnerTemplate,
  PartnerTenantInput,
} from "@corvo/contracts";
import { PartnerAllowanceRefused } from "@corvo/db";
import type { Context, Hono } from "hono";
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

export interface PartnerRouteDeps {
  webOrigin: string;
  now(): Date;
  /** Counts one request and says whether the partner is still within its limit. */
  allowRequest(partnerId: string): Promise<boolean>;
  /** The partner a key belongs to, or null for any key that is not usable. */
  authenticate(key: string): Promise<{ id: string; template?: unknown } | null>;
  provision(
    partner: { id: string },
    input: { externalTenantId: string; name: string },
  ): Promise<{
    tenantId: string;
    organizationId: string;
    spaceId: string;
    ownerUserId: string;
    created: boolean;
  }>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(partnerId: string, externalTenantId: string): Promise<TenantRow | null>;
  setState(
    partnerId: string,
    externalTenantId: string,
    state: "enabled" | "suspended",
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
    expiresAt: Date;
  }): Promise<void>;
}

/** The same answer whether a customer is missing or belongs to someone else. */
const notFound = (c: Context) => c.json({ error: "Not found" }, 404);

function currentPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The API a partner's own system calls to manage its customers and let their people in. */
export function mountPartnerRoutes(app: Hono, deps: PartnerRouteDeps): void {
  /** Resolves the calling partner, or the response that refuses the call. */
  const authorize = async (c: Context): Promise<{ id: string; template?: unknown } | Response> => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
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

    const tenant = await deps.provision(partner, { externalTenantId, name: input.name });
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
    if (connector || agents.length > 0) {
      try {
        await deps.install(owner, partner.id, { connector, agents });
      } catch (error) {
        // An address this deployment may not call is the partner's input to fix, not a fault.
        if ((error as { code?: unknown })?.code === "BAD_REQUEST") {
          return c.json({ error: "Invalid connector" }, 400);
        }
        throw error;
      }
    }
    if (input.state) await deps.setState(partner.id, externalTenantId, input.state);
    if (input.allowanceCents) {
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
    return c.json({ tenantId: tenant.tenantId, created: tenant.created });
  });

  for (const [action, state] of [
    ["suspend", "suspended"],
    ["resume", "enabled"],
  ] as const) {
    app.post(`/api/partner/v1/tenants/:externalTenantId/${action}`, async (c) => {
      const partner = await authorize(c);
      if (partner instanceof Response) return partner;
      const found = await deps.setState(partner.id, c.req.param("externalTenantId"), state);
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
    const { externalTenantId, externalUserId, email } = parsed.data;

    const tenant = await deps.findTenant(partner.id, externalTenantId);
    if (tenant?.state !== "enabled") return notFound(c);

    const code = randomBytes(32).toString("base64url");
    const expiresAt = new Date(deps.now().getTime() + PARTNER_ENTRY_CODE_TTL_MS);
    await deps.storeEntryCode({
      codeHash: createHash("sha256").update(code).digest("hex"),
      partnerId: partner.id,
      tenantId: tenant.id,
      externalUserId,
      externalEmail: email ?? null,
      expiresAt,
    });
    const url = new URL("/api/partner/enter", deps.webOrigin);
    url.searchParams.set("code", code);
    return c.json({ url: url.toString(), code, expiresAt: expiresAt.toISOString() });
  });
}
