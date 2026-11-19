import {
  CONSULTATION_AUDIO_TYPES,
  CONSULTATION_CHUNK_MAX_BYTES,
  CONSULTATION_DEFAULT_RETENTION_DAYS,
  CONSULTATION_MAX_CHUNKS,
  CONSULTATION_STRUCTURED,
  ConsultationCreateInput,
  type ConsultationOutput,
  type ConsultationStatus,
  type ConsultationTurn,
  EmbedConsultationCreateInput,
} from "@corvo/contracts";
import type { Context, Hono } from "hono";
import { cancelBody } from "./http-body.js";
import { resolveAssistPreset } from "./partner-assist-presets.js";

const MAX_KEY_LENGTH = 128;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const SEQ = /^\d{1,4}$/;
const MAX_JSON_BYTES = 16 * 1024;

export type ChunkOutcome = "stored" | "duplicate" | "too_many" | "too_large" | "closed";

export interface ConsultationView {
  id: string;
  state: string;
  draftEntryId: string | null;
  errorCode: string | null;
  chunkCount: number;
}

export interface PartnerConsultationDeps {
  now(): Date;
  /** Counts one request and says whether the partner is still within its limit. */
  allowRequest(partnerId: string): Promise<boolean>;
  authenticate(key: string): Promise<{
    id: string;
    scribeRetentionDays?: number | null;
    template?: unknown;
  } | null>;
  /** Only ever finds a customer of the partner asking. */
  findTenant(
    partnerId: string,
    externalTenantId: string,
  ): Promise<{ id: string; organizationId: string; state: string } | null>;
  /** Whether the customer still has credit to pay for transcription and the models. */
  hasCredit(organizationId: string): Promise<boolean>;
  create(input: {
    partnerId: string;
    tenantId: string;
    externalUserId: string;
    template: string;
    context: object;
    consent: object;
    retentionDays: number;
  }): Promise<{ id: string }>;
  /** Only a consultation of this partner and customer whose content has not been deleted. */
  find(scope: {
    partnerId: string;
    tenantId: string;
    organizationId: string;
    id: string;
  }): Promise<ConsultationView | null>;
  /** Seals the chunk and records it; a repeated seq is `duplicate` and stores nothing. */
  storeChunk(
    consultation: { id: string; organizationId: string },
    chunk: { seq: number; bytes: Uint8Array; mimeType: string },
  ): Promise<ChunkOutcome>;
  /** Moves a recording to processing and queues the job. False when it was not recording. */
  finish(consultationId: string): Promise<boolean>;
  /** The transcript and note of a drafted consultation, from sealed storage. */
  result(consultation: {
    id: string;
    organizationId: string;
  }): Promise<{ turns: ConsultationTurn[]; note?: Record<string, unknown> } | null>;
  remove(consultationId: string): Promise<void>;
  /** Content-free audit of an access or a deletion. */
  audit(event: {
    type: "consultation.created" | "consultation.accessed" | "consultation.deleted";
    consultationId: string;
    partnerId: string;
    organizationId: string;
    action: string;
  }): void;
}

/** The same answer whether a consultation is missing or belongs to someone else. */
const notFound = (c: Context) => c.json({ error: "Not found" }, 404);

/** Reads at most `maxBytes` of the body, or null when it is larger. */
async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) {
      cancelBody(request.body);
      return null;
    }
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        cancelBody(reader);
        return null;
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

type ConsultationPartner = {
  id: string;
  scribeRetentionDays?: number | null;
  template?: unknown;
};
export type ConsultationScope = {
  partner: ConsultationPartner;
  tenant: { id: string; organizationId: string };
};
/** Who is recording, or the response that refuses the call. */
type ResolveScope = (
  c: Context,
  options?: { count: boolean },
) => Promise<Response | ConsultationScope>;

/** The recording API of a partner's own system, scoped to one of its customers. */
export function mountPartnerConsultationRoutes(app: Hono, deps: PartnerConsultationDeps): void {
  const scope: ResolveScope = async (c, { count } = { count: true }) => {
    const header = c.req.header("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const partner = key && key.length <= MAX_KEY_LENGTH ? await deps.authenticate(key) : null;
    if (!partner) return c.json({ error: "Unauthorized" }, 401);
    // Audio uploads are bounded by each consultation's own caps instead of a per-minute count,
    // which a few live visits would use up.
    if (count && !(await deps.allowRequest(partner.id))) {
      return c.json({ error: "Too many requests" }, 429);
    }
    const externalTenantId = c.req.param("externalTenantId") ?? "";
    const tenant = ID.test(externalTenantId)
      ? await deps.findTenant(partner.id, externalTenantId)
      : null;
    if (tenant?.state !== "enabled") return notFound(c);
    return { partner, tenant };
  };
  mountConsultationRoutes(app, deps, {
    base: "/api/partner/v1/tenants/:externalTenantId/consultations",
    scope,
    parse: (json) => ConsultationCreateInput.safeParse(json),
  });
}

/**
 * The same recording API for the page that embeds Rook: the signed-in session stands for the
 * partner and its customer, so the browser records without the partner's key. `session` resolves
 * the caller from its bearer token and refuses a customer that is not enabled.
 */
export function mountEmbedConsultationRoutes(
  app: Hono,
  deps: PartnerConsultationDeps,
  session: (request: Request) => Promise<ConsultationScope | null>,
): void {
  const scope: ResolveScope = async (c, { count } = { count: true }) => {
    const found = await session(c.req.raw);
    if (!found) return c.json({ error: "Unauthorized" }, 401);
    if (count && !(await deps.allowRequest(found.partner.id))) {
      return c.json({ error: "Too many requests" }, 429);
    }
    return found;
  };
  mountConsultationRoutes(app, deps, {
    base: "/api/partner/embed/consultations",
    scope,
    parse: (json) => {
      const parsed = EmbedConsultationCreateInput.safeParse(json);
      return parsed.success
        ? {
            success: true,
            data: { ...parsed.data, externalUserId: parsed.data.externalUserId ?? "embed" },
          }
        : { success: false };
    },
  });
}

function mountConsultationRoutes(
  app: Hono,
  deps: PartnerConsultationDeps,
  options: {
    base: string;
    scope: ResolveScope;
    parse(json: unknown): { success: true; data: ConsultationCreateInput } | { success: false };
  },
): void {
  const { base, scope } = options;

  const consultationOf = async (
    c: Context,
    found: { partner: { id: string }; tenant: { id: string; organizationId: string } },
  ) => {
    const id = c.req.param("consultationId") ?? "";
    if (!ID.test(id)) return null;
    return deps.find({
      partnerId: found.partner.id,
      tenantId: found.tenant.id,
      organizationId: found.tenant.organizationId,
      id,
    });
  };

  const audit = (
    found: { partner: { id: string }; tenant: { organizationId: string } },
    consultationId: string,
    type: Parameters<PartnerConsultationDeps["audit"]>[0]["type"],
    action: string,
  ) =>
    deps.audit({
      type,
      consultationId,
      partnerId: found.partner.id,
      organizationId: found.tenant.organizationId,
      action,
    });

  app.post(base, async (c) => {
    const found = await scope(c);
    if (found instanceof Response) return found;
    const raw = await readBoundedBytes(c.req.raw, MAX_JSON_BYTES);
    if (raw === null) return c.json({ error: "Payload too large" }, 413);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(raw) || "{}");
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const parsed = options.parse(json);
    if (!parsed.success) return c.json({ error: "Invalid request" }, 400);
    const input = parsed.data;
    // A named task is the partner's own, from its template; it is stored as the recording's order.
    let output: ConsultationOutput | undefined;
    if (input.template === CONSULTATION_STRUCTURED && input.context.output) {
      const resolved = resolveAssistPreset(found.partner.template, input.context.output);
      if (!resolved) return c.json({ error: "unknown_preset" }, 400);
      output = resolved;
    }
    if (!(await deps.hasCredit(found.tenant.organizationId))) {
      return c.json({ error: "allowance_exhausted" }, 402);
    }
    const created = await deps.create({
      partnerId: found.partner.id,
      tenantId: found.tenant.id,
      externalUserId: input.externalUserId,
      template: input.template,
      context: output ? { ...input.context, output } : input.context,
      consent: input.consent,
      retentionDays:
        input.retentionDays ??
        found.partner.scribeRetentionDays ??
        CONSULTATION_DEFAULT_RETENTION_DAYS,
    });
    audit(found, created.id, "consultation.created", "create");
    return c.json({ consultationId: created.id });
  });

  app.put(`${base}/:consultationId/chunks/:seq`, async (c) => {
    const found = await scope(c, { count: false });
    if (found instanceof Response) return found;
    const consultation = await consultationOf(c, found);
    if (!consultation) return notFound(c);
    const seqParam = c.req.param("seq") ?? "";
    if (!SEQ.test(seqParam)) return c.json({ error: "Invalid chunk number" }, 400);
    const seq = Number(seqParam);
    const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!(CONSULTATION_AUDIO_TYPES as readonly string[]).includes(type)) {
      cancelBody(c.req.raw.body);
      return c.json({ error: "Unsupported audio type" }, 415);
    }
    if (consultation.state !== "recording") {
      cancelBody(c.req.raw.body);
      return c.json({ error: "not_recording" }, 409);
    }
    if (seq >= CONSULTATION_MAX_CHUNKS) {
      cancelBody(c.req.raw.body);
      return c.json({ error: "too_long" }, 413);
    }
    const bytes = await readBoundedBytes(c.req.raw, CONSULTATION_CHUNK_MAX_BYTES);
    if (bytes === null) return c.json({ error: "Payload too large" }, 413);
    if (bytes.byteLength === 0) return c.json({ error: "Empty chunk" }, 400);
    const outcome = await deps.storeChunk(
      { id: consultation.id, organizationId: found.tenant.organizationId },
      { seq, bytes, mimeType: type },
    );
    if (outcome === "too_many") return c.json({ error: "too_long" }, 413);
    if (outcome === "too_large") return c.json({ error: "too_large" }, 413);
    if (outcome === "closed") return c.json({ error: "not_recording" }, 409);
    return c.json({ ok: true });
  });

  // `finish` closes a recording and also reprocesses a failed one; `reprocess` only the latter.
  // Either repeats the current state when asked again, and starts processing at most once.
  for (const action of ["finish", "reprocess"] as const) {
    app.post(`${base}/:consultationId/${action}`, async (c) => {
      const found = await scope(c);
      if (found instanceof Response) return found;
      const consultation = await consultationOf(c, found);
      if (!consultation) return notFound(c);
      // Finishing twice, or after the result, repeats the answer instead of starting again.
      // A failed consultation is processed again from its stored chunks.
      const startable = action === "finish" ? ["recording", "failed"] : ["failed"];
      if (!startable.includes(consultation.state)) return c.json({ state: consultation.state });
      if (consultation.chunkCount === 0) return c.json({ error: "no_audio" }, 409);
      if (!(await deps.hasCredit(found.tenant.organizationId))) {
        return c.json({ error: "allowance_exhausted" }, 402);
      }
      await deps.finish(consultation.id);
      return c.json({ state: "processing" });
    });
  }

  app.get(`${base}/:consultationId`, async (c) => {
    const found = await scope(c);
    if (found instanceof Response) return found;
    const consultation = await consultationOf(c, found);
    if (!consultation) return notFound(c);
    const status: ConsultationStatus = { state: consultation.state as ConsultationStatus["state"] };
    if (consultation.state === "drafted") {
      // Only a read that returns the transcript is an access; polling while it is made is not.
      audit(found, consultation.id, "consultation.accessed", "read");
      const result = await deps.result({
        id: consultation.id,
        organizationId: found.tenant.organizationId,
      });
      if (result) {
        status.transcript = result.turns;
        if (result.note) status.note = result.note;
      }
      if (consultation.draftEntryId) status.draftEntryId = consultation.draftEntryId;
    }
    if (consultation.state === "failed" && consultation.errorCode) {
      status.error = {
        code: consultation.errorCode as NonNullable<ConsultationStatus["error"]>["code"],
      };
    }
    c.header("cache-control", "no-store");
    return c.json(status);
  });

  app.delete(`${base}/:consultationId`, async (c) => {
    const found = await scope(c);
    if (found instanceof Response) return found;
    const consultation = await consultationOf(c, found);
    if (!consultation) return notFound(c);
    await deps.remove(consultation.id);
    audit(found, consultation.id, "consultation.deleted", "delete");
    return c.json({ ok: true });
  });
}
