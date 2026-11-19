import { compileAssistSchema, runStructuredAssist } from "@corvo/adapters";
import type { AssistErrorCode } from "@corvo/contracts";
import { AssistAskInput, AssistPresets } from "@corvo/contracts";
import type { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { readBoundedBody } from "./http-body.js";

const MAX_KEY_LENGTH = 128;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_BODY_BYTES = 160 * 1024;
const MODEL_TIMEOUT_MS = 90_000;
const FAILED = /^(?:I hit a problem:|Unknown model )/i;
const NO_CREDITS = /Not enough model credits/i;

export type AssistVia = "api" | "embed";

export interface AssistCaller {
  partner: { id: string; template?: unknown };
  tenant: { id: string; organizationId: string; state: string };
}

export interface PartnerAssistDeps {
  /** Counts one request and says whether the partner is still within its limit. */
  allowRequest(partnerId: string): Promise<boolean>;
  authenticate(key: string): Promise<{ id: string; template?: unknown } | null>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(
    partnerId: string,
    externalTenantId: string,
  ): Promise<{ id: string; organizationId: string; state: string } | null>;
  /** The partner and customer a bearer session belongs to, or null. */
  session(request: Request): Promise<AssistCaller | null>;
  /** Whether the customer may use Rook at all (not suspended, plan in good standing). */
  hasAccess(organizationId: string): Promise<boolean>;
  /** Whether the customer still has credit to pay for the models. */
  hasCredit(organizationId: string): Promise<boolean>;
  /**
   * One tool-less model call on the customer's own routing, metered like any run. Returns the
   * model's text, or undefined when no model is configured.
   */
  complete(call: {
    organizationId: string;
    operation: string;
    instructions: string;
    prompt: string;
    timeoutMs: number;
    onText?: (text: string) => void;
  }): Promise<string | undefined>;
  /** Content-free audit of one run. */
  audit(event: {
    partnerId: string;
    organizationId: string;
    via: AssistVia;
    task: string;
    outcome: "ok" | AssistErrorCode;
    attempts: number;
  }): void;
}

/** A refusal the caller can act on; the code is all that is sent. */
class AssistRefusal extends Error {
  constructor(readonly code: AssistErrorCode) {
    super(code);
  }
}

const STATUS: Record<AssistErrorCode, 400 | 402 | 422 | 502 | 503> = {
  unknown_preset: 400,
  invalid_schema: 400,
  invalid_output: 422,
  allowance_exhausted: 402,
  model_failed: 502,
  no_model: 503,
};

/**
 * Lets a page on any origin call the embed routes with its bearer token. The token is the only
 * credential and no cookie is sent, so no origin gains anything it did not already hold.
 */
export function mountEmbedCors(app: Hono, prefix = "/api/partner/embed/*"): void {
  app.use(
    prefix,
    cors({
      origin: "*",
      allowHeaders: ["authorization", "content-type", "x-corvo-space-id"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
}

/** Headless structured assist: a task and a schema in, a validated result out. */
export function mountPartnerAssistRoutes(app: Hono, deps: PartnerAssistDeps): void {
  const run = async (c: Context, caller: AssistCaller, via: AssistVia): Promise<Response> => {
    const raw = await readBoundedBody(c.req.raw, MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    let json: unknown;
    try {
      json = raw === "" ? {} : JSON.parse(raw);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = AssistAskInput.safeParse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const input = parsed.data;

    // What the partner's template sets for a named task; the request's own fields win.
    const presets = AssistPresets.safeParse(
      (caller.partner.template as { assist?: unknown } | null)?.assist,
    ).data;
    const preset = input.preset ? presets?.[input.preset] : undefined;
    if (input.preset && !preset) return c.json({ error: "unknown_preset" }, STATUS.unknown_preset);
    const task = input.task ?? preset?.task ?? "";
    const instructions = input.instructions ?? preset?.instructions;
    const schema = input.schema ?? preset?.schema;
    if (schema && !compileAssistSchema(schema)) {
      return c.json({ error: "invalid_schema" }, STATUS.invalid_schema);
    }

    const { organizationId } = caller.tenant;
    // The customer's access decides before any model is asked, and again by the credit check.
    if (caller.tenant.state !== "enabled" || !(await deps.hasAccess(organizationId))) {
      return c.json({ error: "access_inactive" }, 403);
    }
    if (!(await deps.hasCredit(organizationId))) {
      return c.json({ error: "allowance_exhausted" }, STATUS.allowance_exhausted);
    }

    const label = input.preset ?? "custom";
    let attempts = 0;
    const execute = async (
      onText?: (text: string) => void,
      onRetry?: () => void,
    ): Promise<Record<string, unknown>> => {
      const outcome = await runStructuredAssist(
        {
          complete: async (call) => {
            attempts += 1;
            const text = await deps.complete({
              organizationId,
              operation: call.operation,
              instructions: call.instructions,
              prompt: call.prompt,
              timeoutMs: MODEL_TIMEOUT_MS,
              ...(onText ? { onText } : {}),
            });
            if (text === undefined) throw new AssistRefusal("no_model");
            if (NO_CREDITS.test(text)) throw new AssistRefusal("allowance_exhausted");
            if (FAILED.test(text.trim())) throw new AssistRefusal("model_failed");
            return text;
          },
          ...(onRetry ? { onRetry } : {}),
        },
        {
          task,
          ...(instructions ? { instructions } : {}),
          ...(input.context === undefined ? {} : { context: input.context }),
          ...(schema ? { schema } : {}),
        },
        `partner-assist:${label}`,
      );
      if (!outcome.ok) throw new AssistRefusal(outcome.reason);
      return outcome.result;
    };
    const audit = (outcome: "ok" | AssistErrorCode) =>
      deps.audit({
        partnerId: caller.partner.id,
        organizationId,
        via,
        task: label,
        outcome,
        attempts,
      });
    const codeOf = (error: unknown): AssistErrorCode =>
      error instanceof AssistRefusal ? error.code : "model_failed";

    if (input.stream) {
      c.header("cache-control", "no-store");
      return streamSSE(c, async (stream) => {
        try {
          const result = await execute(
            (text) => void stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) }),
            () => void stream.writeSSE({ event: "retry", data: "{}" }),
          );
          audit("ok");
          await stream.writeSSE({ event: "result", data: JSON.stringify({ result }) });
        } catch (error) {
          const code = codeOf(error);
          audit(code);
          await stream.writeSSE({ event: "error", data: JSON.stringify({ error: code }) });
        }
      });
    }
    try {
      const result = await execute();
      audit("ok");
      c.header("cache-control", "no-store");
      return c.json({ result });
    } catch (error) {
      const code = codeOf(error);
      audit(code);
      return c.json({ error: code }, STATUS[code]);
    }
  };

  app.post("/api/partner/v1/tenants/:externalTenantId/ask", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
    if (!(await deps.allowRequest(partner.id))) return c.json({ error: "Too many requests" }, 429);
    const externalTenantId = c.req.param("externalTenantId") ?? "";
    const tenant = ID.test(externalTenantId)
      ? await deps.findTenant(partner.id, externalTenantId)
      : null;
    // The same answer whether a customer is missing, someone else's or not enabled.
    if (tenant?.state !== "enabled") return c.json({ error: "Not found" }, 404);
    return run(c, { partner, tenant }, "api");
  });

  app.post("/api/partner/embed/ask", async (c) => {
    const caller = await deps.session(c.req.raw);
    if (!caller) return c.json({ error: "Unauthorized" }, 401);
    if (!(await deps.allowRequest(caller.partner.id))) {
      return c.json({ error: "Too many requests" }, 429);
    }
    return run(c, caller, "embed");
  });
}
