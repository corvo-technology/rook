import type { RoutineEventTrigger } from "@corvo/contracts";
import {
  PARTNER_EVENT_MAX_BODY_BYTES,
  PARTNER_EVENT_TENANT_PER_MINUTE,
  PartnerEventInput,
} from "@corvo/contracts";
import type { IdempotentOutcome } from "@corvo/db";
import { requestHash } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import type { Hono } from "hono";
import { readBoundedBody } from "./http-body.js";
import { partnerHasScope } from "./partner-routes.js";
import type { WebhookDeps } from "./webhook-inbound.js";
import { deliverWebhookEvent, formatUntrustedDeliveryPayload } from "./webhook-inbound.js";

const MAX_KEY_LENGTH = 128;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,128}$/;
/** What a rejected event keeps of what was sent, so the partner can see its mistake. */
const REJECTED_PAYLOAD_CHARS = 2_000;

/** A routine an event may start: its owner's words and the agent that runs it. */
export interface EventRoutineTarget {
  id: string;
  name: string;
  prompt: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  trigger: RoutineEventTrigger;
  bot: { id: string; spaceId: string; userId: string };
  /** The agent's chat, which a run is queued in; null when it has none. */
  threadId: string | null;
}

export interface PartnerEventRecord {
  partnerId: string;
  externalTenantId: string;
  organizationId: string | null;
  type: string;
  name: string | null;
  status: "accepted" | "rejected";
  error: string | null;
  payload: unknown;
  occurredAt: Date | null;
}

export interface PartnerEventDeps {
  now(): Date;
  allowRequest(partnerId: string): Promise<boolean>;
  authenticate(key: string): Promise<{ id: string; scopes?: string[] | null } | null>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(
    partnerId: string,
    externalTenantId: string,
  ): Promise<{ id: string; organizationId: string; state: string } | null>;
  idempotent(
    partnerId: string,
    key: string,
    hash: string,
    run: () => Promise<{ status: number; body: unknown }>,
  ): Promise<IdempotentOutcome>;
  /** Events this customer's partner sent for it since `since`, refused ones included. */
  countRecent(partnerId: string, externalTenantId: string, since: Date): Promise<number>;
  record(row: PartnerEventRecord): Promise<{ id: string }>;
  /** The customer's active routines started by this kind of event, before any filter. */
  routinesFor(
    organizationId: string,
    trigger: { type: string; name?: string },
  ): Promise<EventRoutineTarget[]>;
  /** Wakes the routine's agent with the prompt; false when the agent cannot be reached. */
  deliver(routine: EventRoutineTarget, event: { id: string; prompt: string }): Promise<boolean>;
  settle(id: string, counts: { matched: number; delivered: number }): Promise<void>;
}

/** The value at a dotted path of plain data, or undefined. */
function valueAt(data: unknown, path: string): unknown {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Whether an event starts a routine: the same type (and name), and every filter holds. */
export function eventMatchesTrigger(
  trigger: RoutineEventTrigger,
  event: Pick<PartnerEventInput, "type" | "name" | "data">,
): boolean {
  if (trigger.type !== event.type) return false;
  if (event.type === "custom" && trigger.name !== event.name) return false;
  return (trigger.filters ?? []).every((filter) => {
    const found = valueAt(event.data, filter.path);
    // Numbers and booleans sent as text still match; the filter's own type decides.
    return found === filter.equals || String(found) === String(filter.equals);
  });
}

/**
 * What wakes the agent. The event is written by the partner's system from whatever its customers
 * typed, so all of it sits inside the untrusted block and none of it is read as instructions.
 */
export function formatPartnerEventPrompt(
  event: Pick<PartnerEventInput, "type" | "name" | "data"> & { occurredAt: string },
): string {
  return formatUntrustedDeliveryPayload(`[Partner Event: ${event.name ?? event.type}]`, {
    type: event.type,
    ...(event.name ? { name: event.name } : {}),
    occurredAt: event.occurredAt,
    data: event.data,
  });
}

/**
 * Wakes the routine's agent the way a webhook does: a run the routine's own words start, with the
 * event after them as untrusted data. The run is a webhook run, so the owner's approval rules
 * decide every change it proposes, exactly as for any inbound event.
 */
export async function deliverPartnerEvent(
  deps: Pick<WebhookDeps, "events" | "jobs">,
  routine: EventRoutineTarget,
  event: { id: string; prompt: string },
): Promise<boolean> {
  if (!routine.threadId) return false;
  try {
    await deliverWebhookEvent(
      deps,
      { bot: routine.bot, threadId: routine.threadId },
      {
        prompt: event.prompt,
        routines: [routine],
        source: "partner_event",
        idempotencyKey: `${event.id}:${routine.id}`,
      },
    );
    return true;
  } catch (error) {
    getLogger().error("partner event delivery", error);
    return false;
  }
}

/**
 * The partner's own system tells a customer's agents what happened: an appointment missed, a
 * payment overdue. The event is logged, then starts every routine of that customer waiting for it;
 * what those agents propose to change still goes through the customer's approval rules.
 */
export function mountPartnerEventRoutes(app: Hono, deps: PartnerEventDeps): void {
  app.post("/api/partner/v1/tenants/:externalTenantId/events", async (c) => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
    if (!partnerHasScope(partner, "tenants:write")) return c.json({ error: "scope" }, 403);
    if (!(await deps.allowRequest(partner.id))) return c.json({ error: "Too many requests" }, 429);

    const externalTenantId = c.req.param("externalTenantId");
    const tenant = ID.test(externalTenantId)
      ? await deps.findTenant(partner.id, externalTenantId)
      : null;
    if (!tenant) return c.json({ error: "Not found" }, 404);

    const idempotencyKey = c.req.header("idempotency-key") ?? "";
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return c.json({ error: "idempotency_key_required" }, 400);
    }
    const raw = await readBoundedBody(c.req.raw, PARTNER_EVENT_MAX_BODY_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);

    const now = deps.now();
    const refuse = async (error: string, status: 400 | 409 | 429, type = "unknown") => {
      await deps.record({
        partnerId: partner.id,
        externalTenantId,
        organizationId: tenant.organizationId,
        type: type.slice(0, 100),
        name: null,
        status: "rejected",
        error,
        payload: raw.slice(0, REJECTED_PAYLOAD_CHARS),
        occurredAt: null,
      });
      return c.json({ error }, status);
    };

    if (tenant.state !== "enabled") return refuse("tenant_suspended", 409);
    let json: unknown;
    try {
      json = raw === "" ? {} : JSON.parse(raw);
    } catch {
      return refuse("invalid_json", 400);
    }
    const parsed = PartnerEventInput.safeParse(json);
    if (!parsed.success) {
      const sent = (json as { type?: unknown } | null)?.type;
      return refuse("invalid_event", 400, typeof sent === "string" ? sent : undefined);
    }
    const input = parsed.data;

    const since = new Date(now.getTime() - 60_000);
    if (
      (await deps.countRecent(partner.id, externalTenantId, since)) >=
      PARTNER_EVENT_TENANT_PER_MINUTE
    ) {
      return c.json({ error: "Too many requests" }, 429);
    }

    const outcome = await deps.idempotent(
      partner.id,
      idempotencyKey,
      requestHash(`POST ${new URL(c.req.url).pathname}`, input),
      async () => {
        const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
        const event = await deps.record({
          partnerId: partner.id,
          externalTenantId,
          organizationId: tenant.organizationId,
          type: input.type,
          name: input.name ?? null,
          status: "accepted",
          error: null,
          payload: input.data,
          occurredAt,
        });
        const candidates = await deps.routinesFor(tenant.organizationId, {
          type: input.type,
          name: input.name,
        });
        const matching = candidates.filter((routine) =>
          eventMatchesTrigger(routine.trigger, input),
        );
        const prompt = formatPartnerEventPrompt({ ...input, occurredAt: occurredAt.toISOString() });
        let delivered = 0;
        for (const routine of matching) {
          if (await deps.deliver(routine, { id: event.id, prompt })) delivered += 1;
        }
        await deps.settle(event.id, { matched: matching.length, delivered });
        return {
          status: 202,
          body: { id: event.id, matched: matching.length, delivered },
        };
      },
    );
    if (outcome.kind === "conflict") return c.json({ error: "idempotency_conflict" }, 409);
    if (outcome.kind === "in_progress") return c.json({ error: "idempotency_in_progress" }, 409);
    return c.json(outcome.body as object, outcome.kind === "ran" ? 202 : 200);
  });
}
