import {
  CONSULTATION_CHUNK_MAX_BYTES,
  CONSULTATION_MAX_CHUNKS,
  CONSULTATION_TEMPLATES,
} from "@corvo/contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { PartnerConsultationDeps } from "./partner-consultations.js";
import {
  mountEmbedConsultationRoutes,
  mountPartnerConsultationRoutes,
} from "./partner-consultations.js";

const KEY_A = "cpk_AAAAAAAA.key-for-partner-a";
const KEY_B = "cpk_BBBBBBBB.key-for-partner-b";
const BASE = "/api/partner/v1/tenants/shop-1/consultations";

const body = () => ({
  externalUserId: "doctor-1",
  template: CONSULTATION_TEMPLATES[0],
  context: { clientId: "client-1", appointmentId: "appt-1", clientName: "Maria" },
  consent: { obtained: true, at: "2026-12-01T10:00:00Z", method: "verbal" },
});

interface Row {
  id: string;
  partnerId: string;
  tenantId: string;
  state: string;
  chunks: Map<number, { size: number; mimeType: string }>;
  retentionDays: number;
  draftEntryId: string | null;
  errorCode: string | null;
}

function fixture(options: { credit?: boolean; maxBytes?: number } = {}) {
  const rows = new Map<string, Row>();
  const audits: Array<Parameters<PartnerConsultationDeps["audit"]>[0]> = [];
  const enqueued: string[] = [];
  const applyCalls: Array<{ consultation: unknown; request: unknown; caller: unknown }> = [];
  const removed: string[] = [];
  const partners: Record<string, { id: string; scribeRetentionDays?: number | null }> = {
    [KEY_A]: { id: "partner-a", scribeRetentionDays: 14 },
    [KEY_B]: { id: "partner-b" },
  };
  const tenants: Record<string, { id: string; organizationId: string; state: string }> = {
    "partner-a/shop-1": { id: "tenant-a1", organizationId: "org-a1", state: "enabled" },
    "partner-a/paused": { id: "tenant-a2", organizationId: "org-a2", state: "suspended" },
    "partner-b/shop-1": { id: "tenant-b1", organizationId: "org-b1", state: "enabled" },
  };
  let total = new Map<string, number>();
  const deps: PartnerConsultationDeps = {
    now: () => new Date("2026-12-01T10:00:00Z"),
    allowRequest: vi.fn(async () => true),
    authenticate: vi.fn(async (key: string) => partners[key] ?? null),
    findTenant: vi.fn(async (partnerId: string, external: string) => {
      return tenants[`${partnerId}/${external}`] ?? null;
    }),
    hasCredit: vi.fn(async () => options.credit ?? true),
    create: vi.fn(async (input) => {
      const id = `cons-${rows.size + 1}`;
      rows.set(id, {
        id,
        partnerId: input.partnerId,
        tenantId: input.tenantId,
        state: "recording",
        chunks: new Map(),
        retentionDays: input.retentionDays,
        draftEntryId: null,
        errorCode: null,
      });
      return { id };
    }),
    find: vi.fn(async (scope) => {
      const row = rows.get(scope.id);
      if (!row || row.partnerId !== scope.partnerId || row.tenantId !== scope.tenantId) return null;
      return {
        id: row.id,
        state: row.state,
        draftEntryId: row.draftEntryId,
        errorCode: row.errorCode,
        chunkCount: row.chunks.size,
      };
    }),
    storeChunk: vi.fn(async (consultation, chunk) => {
      const row = rows.get(consultation.id);
      if (!row || row.state !== "recording") return "closed";
      if (row.chunks.has(chunk.seq)) return "duplicate";
      if (chunk.seq >= CONSULTATION_MAX_CHUNKS) return "too_many";
      const sum = total.get(row.id) ?? 0;
      if (sum + chunk.bytes.byteLength > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)) {
        return "too_large";
      }
      total.set(row.id, sum + chunk.bytes.byteLength);
      row.chunks.set(chunk.seq, { size: chunk.bytes.byteLength, mimeType: chunk.mimeType });
      return "stored";
    }),
    finish: vi.fn(async (id) => {
      const row = rows.get(id);
      if (row?.state !== "recording" && row?.state !== "failed") return false;
      row.state = "processing";
      row.errorCode = null;
      enqueued.push(id);
      return true;
    }),
    result: vi.fn(async () => ({
      turns: [{ speaker: "professional" as const, startMs: 0, text: "Bom dia." }],
      note: { title: "Consulta" },
      actions: [
        {
          id: "a1",
          kind: "follow_up" as const,
          title: "Retorno",
          detail: "",
          payload: { startsAt: "2026-12-08T14:00:00-03:00" },
          status: "proposed" as const,
          evidence: [0],
          check: { available: true },
        },
      ],
    })),
    applyActions: vi.fn(async (consultation, request, caller) => {
      const row = rows.get(consultation.id);
      if (!row) return { ok: false as const, error: "not_found" as const };
      applyCalls.push({ consultation, request, caller });
      if (request.actionIds.some((id) => id !== "a1"))
        return { ok: false as const, error: "unknown_action" as const };
      return {
        ok: true as const,
        actions: [
          {
            id: "a1",
            kind: "follow_up" as const,
            title: "Retorno",
            detail: "",
            payload: request.edits?.a1 ?? {},
            status: "applied" as const,
            evidence: [0],
          },
        ],
      };
    }),
    remove: vi.fn(async (id) => {
      rows.delete(id);
      removed.push(id);
    }),
    audit: vi.fn((event) => void audits.push(event)),
  };
  const app = new Hono();
  mountPartnerConsultationRoutes(app, deps);
  const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
    const { key = KEY_A, ...rest } = init;
    return app.request(path, {
      ...rest,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(rest.headers ?? {}) },
    });
  };
  const create = async (over: Record<string, unknown> = {}) => {
    const response = await call(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body(), ...over }),
    });
    return (await response.json()) as { consultationId: string };
  };
  const chunk = (
    id: string,
    seq: number | string,
    bytes: Uint8Array,
    init: RequestInit & { key?: string | null } = {},
  ) =>
    call(`${BASE}/${id}/chunks/${seq}`, {
      method: "PUT",
      headers: { "content-type": "audio/webm;codecs=opus" },
      body: bytes,
      ...init,
    });
  total = new Map();
  return { app, deps, rows, audits, enqueued, removed, applyCalls, call, create, chunk };
}

describe("consultation recording API", () => {
  describe("authentication and isolation", () => {
    it("answers 401 for a missing, unknown or malformed key on every route", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const routes: Array<[string, string]> = [
        ["POST", BASE],
        ["PUT", `${BASE}/${consultationId}/chunks/0`],
        ["POST", `${BASE}/${consultationId}/finish`],
        ["GET", `${BASE}/${consultationId}`],
        ["DELETE", `${BASE}/${consultationId}`],
      ];
      for (const [method, path] of routes) {
        for (const key of [null, "nope", `${KEY_A}x`, "x".repeat(300)]) {
          const response = await f.call(path, { method, key });
          expect(response.status, `${method} ${path}`).toBe(401);
        }
      }
    });

    it("answers 404 for another partner's customer or consultation, and for a paused customer", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      // Partner B has a customer with the same external id, but not this consultation.
      for (const [method, path] of [
        ["GET", `${BASE}/${consultationId}`],
        ["POST", `${BASE}/${consultationId}/finish`],
        ["DELETE", `${BASE}/${consultationId}`],
      ] as const) {
        expect((await f.call(path, { method, key: KEY_B })).status, path).toBe(404);
      }
      expect((await f.chunk(consultationId, 0, new Uint8Array([1]), { key: KEY_B })).status).toBe(
        404,
      );
      // A customer that does not exist, and one that is paused, look the same.
      const missing = await f.call("/api/partner/v1/tenants/nobody/consultations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      expect(missing.status).toBe(404);
      const paused = await f.call("/api/partner/v1/tenants/paused/consultations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      expect(paused.status).toBe(404);
      // Nothing of partner A's was touched.
      expect(f.rows.get(consultationId)?.state).toBe("recording");
      expect((await f.call(`${BASE}/${consultationId}`)).status).toBe(200);
    });

    it("answers 404 for an unknown or badly formed consultation id", async () => {
      const f = fixture();
      expect((await f.call(`${BASE}/missing`)).status).toBe(404);
      expect((await f.call(`${BASE}/a%20b`)).status).toBe(404);
    });
  });

  describe("create", () => {
    it("returns an id and uses the partner's retention default, or the request's own", async () => {
      const f = fixture();
      const first = await f.create();
      const second = await f.create({ retentionDays: 90 });
      expect(f.rows.get(first.consultationId)?.retentionDays).toBe(14);
      expect(f.rows.get(second.consultationId)?.retentionDays).toBe(90);
      const bare = fixture();
      const response = await bare.call(BASE, {
        method: "POST",
        key: KEY_B,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      // Partner B has no tenant "shop-1" enabled? It does: its default is 30 days.
      const { consultationId } = (await response.json()) as { consultationId: string };
      expect(bare.rows.get(consultationId)?.retentionDays).toBe(30);
    });

    it("requires the patient's consent, a known template and a sane retention", async () => {
      const f = fixture();
      const post = (payload: unknown) =>
        f.call(BASE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      expect(
        (
          await post({
            ...body(),
            consent: { obtained: false, at: "2026-12-01T10:00:00Z", method: "verbal" },
          })
        ).status,
      ).toBe(400);
      expect((await post({ ...body(), consent: undefined })).status).toBe(400);
      expect((await post({ ...body(), template: "other" })).status).toBe(400);
      expect((await post({ ...body(), retentionDays: 0 })).status).toBe(400);
      expect((await post({ ...body(), retentionDays: 4000 })).status).toBe(400);
      expect((await post({ ...body(), extra: 1 })).status).toBe(400);
      expect(f.rows.size).toBe(0);
      const bad = await f.call(BASE, { method: "POST", body: "{nope" });
      expect(bad.status).toBe(400);
    });

    it("refuses with 402 when the customer's credit is used up", async () => {
      const f = fixture({ credit: false });
      const response = await f.call(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      expect(response.status).toBe(402);
      expect(await response.json()).toEqual({ error: "allowance_exhausted" });
      expect(f.rows.size).toBe(0);
    });

    it("audits the creation without content", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      expect(f.audits).toEqual([
        {
          type: "consultation.created",
          consultationId,
          partnerId: "partner-a",
          organizationId: "org-a1",
          action: "create",
        },
      ]);
    });
  });

  describe("chunks", () => {
    it("stores a chunk and treats a repeated seq as success that stores nothing", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const first = await f.chunk(consultationId, 0, new Uint8Array([1, 2, 3]));
      expect(await first.json()).toEqual({ ok: true });
      const repeat = await f.chunk(consultationId, 0, new Uint8Array([9, 9]));
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toEqual({ ok: true });
      expect(f.rows.get(consultationId)?.chunks.get(0)?.size).toBe(3);
      expect(f.rows.get(consultationId)?.chunks.size).toBe(1);
    });

    it("accepts chunks out of order and keeps the type without its parameters", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      for (const seq of [2, 0, 1]) {
        expect((await f.chunk(consultationId, seq, new Uint8Array([seq + 1]))).status).toBe(200);
      }
      const row = f.rows.get(consultationId);
      expect([...(row?.chunks.keys() ?? [])].sort()).toEqual([0, 1, 2]);
      expect(row?.chunks.get(0)?.mimeType).toBe("audio/webm");
    });

    it("refuses a chunk over 2 MB with 413, whether declared or streamed", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const big = new Uint8Array(CONSULTATION_CHUNK_MAX_BYTES + 1);
      expect((await f.chunk(consultationId, 0, big)).status).toBe(413);
      const exact = new Uint8Array(CONSULTATION_CHUNK_MAX_BYTES);
      expect((await f.chunk(consultationId, 1, exact)).status).toBe(200);
      const streamed = await f.call(`${BASE}/${consultationId}/chunks/2`, {
        method: "PUT",
        headers: { "content-type": "audio/ogg" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(CONSULTATION_CHUNK_MAX_BYTES));
            controller.enqueue(new Uint8Array(1));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
      expect(streamed.status).toBe(413);
    });

    it("refuses past the duration cap and the total size cap", async () => {
      const f = fixture({ maxBytes: 10 });
      const { consultationId } = await f.create();
      const late = await f.chunk(consultationId, CONSULTATION_MAX_CHUNKS, new Uint8Array([1]));
      expect(late.status).toBe(413);
      expect(await late.json()).toEqual({ error: "too_long" });
      expect((await f.chunk(consultationId, 0, new Uint8Array(8))).status).toBe(200);
      const over = await f.chunk(consultationId, 1, new Uint8Array(8));
      expect(over.status).toBe(413);
      expect(await over.json()).toEqual({ error: "too_large" });
    });

    it("refuses other audio types, an empty body and a bad number", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const wrongType = await f.call(`${BASE}/${consultationId}/chunks/0`, {
        method: "PUT",
        headers: { "content-type": "audio/mpeg" },
        body: new Uint8Array([1]),
      });
      expect(wrongType.status).toBe(415);
      expect((await f.chunk(consultationId, 0, new Uint8Array())).status).toBe(400);
      expect((await f.chunk(consultationId, "x", new Uint8Array([1]))).status).toBe(400);
      expect((await f.chunk(consultationId, "-1", new Uint8Array([1]))).status).toBe(400);
    });

    it("answers 409 once the recording is finished", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      const late = await f.chunk(consultationId, 1, new Uint8Array([1]));
      expect(late.status).toBe(409);
    });

    it("does not count uploads against the partner's request limit", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      vi.mocked(f.deps.allowRequest).mockClear();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      expect(f.deps.allowRequest).not.toHaveBeenCalled();
    });
  });

  describe("finish, status and delete", () => {
    it("starts processing once and repeats the state when asked again", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      const first = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(await first.json()).toEqual({ state: "processing" });
      const second = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(await second.json()).toEqual({ state: "processing" });
      expect(f.enqueued).toEqual([consultationId]);
    });

    it("reprocesses a failed consultation from its stored chunks, once", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      const row = f.rows.get(consultationId) as Row;
      row.state = "failed";
      row.errorCode = "model_failed";
      const again = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(await again.json()).toEqual({ state: "processing" });
      expect(f.enqueued).toEqual([consultationId]);
      expect(row.errorCode).toBeNull();
      const repeat = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(await repeat.json()).toEqual({ state: "processing" });
      expect(f.enqueued).toEqual([consultationId]);
    });

    it("reprocess restarts only a failed consultation and otherwise answers the current state", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      const row = f.rows.get(consultationId) as Row;
      const post = () => f.call(`${BASE}/${consultationId}/reprocess`, { method: "POST" });
      expect(await (await post()).json()).toEqual({ state: "recording" });
      expect(f.enqueued).toEqual([]);
      row.state = "failed";
      vi.mocked(f.deps.hasCredit).mockResolvedValueOnce(false);
      expect((await post()).status).toBe(402);
      expect(await (await post()).json()).toEqual({ state: "processing" });
      expect(await (await post()).json()).toEqual({ state: "processing" });
      row.state = "drafted";
      expect(await (await post()).json()).toEqual({ state: "drafted" });
      expect(f.enqueued).toEqual([consultationId]);
      expect(
        (await f.call(`${BASE}/${consultationId}/reprocess`, { method: "POST", key: KEY_B }))
          .status,
      ).toBe(404);
    });

    it("refuses to finish an empty recording or one the customer cannot pay for", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const empty = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(empty.status).toBe(409);
      expect(await empty.json()).toEqual({ error: "no_audio" });
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      vi.mocked(f.deps.hasCredit).mockResolvedValue(false);
      const broke = await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(broke.status).toBe(402);
      expect(f.enqueued).toEqual([]);
      expect(f.rows.get(consultationId)?.state).toBe("recording");
    });

    it("reports recording and processing without content, and audits nothing for them", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      expect(await (await f.call(`${BASE}/${consultationId}`)).json()).toEqual({
        state: "recording",
      });
      f.audits.length = 0;
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      await f.call(`${BASE}/${consultationId}/finish`, { method: "POST" });
      expect(await (await f.call(`${BASE}/${consultationId}`)).json()).toEqual({
        state: "processing",
      });
      expect(f.audits).toEqual([]);
      expect(f.deps.result).not.toHaveBeenCalled();
    });

    it("returns the transcript, note and draft id once drafted, and audits the read", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const row = f.rows.get(consultationId) as Row;
      row.state = "drafted";
      row.draftEntryId = "entry-9";
      f.audits.length = 0;
      const response = await f.call(`${BASE}/${consultationId}`);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        state: "drafted",
        transcript: [{ speaker: "professional", startMs: 0, text: "Bom dia." }],
        note: { title: "Consulta" },
        actions: [
          expect.objectContaining({ id: "a1", status: "proposed", check: { available: true } }),
        ],
        draftEntryId: "entry-9",
      });
      expect(f.audits).toEqual([
        {
          type: "consultation.accessed",
          consultationId,
          partnerId: "partner-a",
          organizationId: "org-a1",
          action: "read",
        },
      ]);
    });

    describe("agreed actions", () => {
      const apply = (
        f: ReturnType<typeof fixture>,
        id: string,
        body: unknown,
        key?: string | null,
      ) =>
        f.call(`${BASE}/${id}/actions/apply`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          ...(key === undefined ? {} : { key }),
        });
      const drafted = async () => {
        const f = fixture();
        const { consultationId } = await f.create();
        (f.rows.get(consultationId) as Row).state = "drafted";
        return { f, consultationId };
      };

      it("applies only the named actions and returns what became of them, with the edit", async () => {
        const { f, consultationId } = await drafted();
        const response = await apply(f, consultationId, {
          actionIds: ["a1"],
          edits: { a1: { startsAt: "2026-12-09T09:00:00-03:00" } },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.json()).toEqual({
          actions: [
            expect.objectContaining({
              id: "a1",
              status: "applied",
              payload: { startsAt: "2026-12-09T09:00:00-03:00" },
            }),
          ],
        });
        expect(f.applyCalls).toHaveLength(1);
      });

      it("never runs anything when reading the consultation", async () => {
        const { f, consultationId } = await drafted();
        await f.call(`${BASE}/${consultationId}`);
        expect(f.deps.applyActions).not.toHaveBeenCalled();
      });

      it("refuses a bad request, an unknown action, and a consultation that is not drafted yet", async () => {
        const { f, consultationId } = await drafted();
        expect((await apply(f, consultationId, {})).status).toBe(400);
        expect((await apply(f, consultationId, { actionIds: [] })).status).toBe(400);
        expect((await apply(f, consultationId, { actionIds: ["a1"], extra: 1 })).status).toBe(400);
        const unknown = await apply(f, consultationId, { actionIds: ["zz"] });
        expect(unknown.status).toBe(400);
        expect(await unknown.json()).toEqual({ error: "unknown_action" });
        const fresh = await f.create();
        const early = await apply(f, fresh.consultationId, { actionIds: ["a1"] });
        expect(early.status).toBe(409);
        expect(await early.json()).toEqual({ error: "not_drafted" });
      });

      it("needs the partner's key and never reaches another partner's or customer's consultation", async () => {
        const { f, consultationId } = await drafted();
        expect((await apply(f, consultationId, { actionIds: ["a1"] }, null)).status).toBe(401);
        expect((await apply(f, consultationId, { actionIds: ["a1"] }, "bad-key")).status).toBe(401);
        expect((await apply(f, consultationId, { actionIds: ["a1"] }, KEY_B)).status).toBe(404);
        expect((await apply(f, "nope", { actionIds: ["a1"] })).status).toBe(404);
        const other = await f.call(
          `/api/partner/v1/tenants/paused/consultations/${consultationId}/actions/apply`,
          { method: "POST", body: JSON.stringify({ actionIds: ["a1"] }) },
        );
        expect(other.status).toBe(404);
        expect(f.deps.applyActions).not.toHaveBeenCalled();
      });
    });

    it("returns only the error code when failed", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      const row = f.rows.get(consultationId) as Row;
      row.state = "failed";
      row.errorCode = "connector_failed";
      expect(await (await f.call(`${BASE}/${consultationId}`)).json()).toEqual({
        state: "failed",
        error: { code: "connector_failed" },
      });
    });

    it("deletes on request, audits it, and then answers 404", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      f.audits.length = 0;
      const response = await f.call(`${BASE}/${consultationId}`, { method: "DELETE" });
      expect(await response.json()).toEqual({ ok: true });
      expect(f.removed).toEqual([consultationId]);
      expect(f.audits).toEqual([
        {
          type: "consultation.deleted",
          consultationId,
          partnerId: "partner-a",
          organizationId: "org-a1",
          action: "delete",
        },
      ]);
      expect((await f.call(`${BASE}/${consultationId}`)).status).toBe(404);
      expect((await f.call(`${BASE}/${consultationId}`, { method: "DELETE" })).status).toBe(404);
    });

    it("never puts what the partner sent into an audit event", async () => {
      const f = fixture();
      const { consultationId } = await f.create();
      await f.chunk(consultationId, 0, new Uint8Array([1]));
      await f.call(`${BASE}/${consultationId}`, { method: "DELETE" });
      const text = JSON.stringify(f.audits);
      expect(text).not.toContain("Maria");
      expect(text).not.toContain("client-1");
      expect(text).not.toContain("doctor-1");
    });
  });
});

describe("structured recording for an embedded page", () => {
  const EMBED = "/api/partner/embed/consultations";
  const TOKEN = "embed-session-token";
  const SCHEMA = {
    type: "object",
    properties: { chiefComplaint: { type: "string" } },
    required: ["chiefComplaint"],
  };
  const template = { assist: { anamnesis: { task: "Fill the anamnesis", schema: SCHEMA } } };

  function embedFixture() {
    const f = fixture();
    mountEmbedConsultationRoutes(f.app, f.deps, async (request) =>
      request.headers.get("authorization") === `Bearer ${TOKEN}`
        ? {
            partner: { id: "partner-a", scribeRetentionDays: 14, template },
            tenant: { id: "tenant-a1", organizationId: "org-a1" },
            userId: "session-user",
          }
        : null,
    );
    const embed = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
      f.app.request(path, {
        ...init,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
      });
    const create = (over: Record<string, unknown> = {}) =>
      embed(EMBED, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template: "structured",
          context: { clientId: "client-1", output: { preset: "anamnesis" } },
          consent: { obtained: true, at: "2026-12-01T10:00:00Z", method: "verbal" },
          ...over,
        }),
      });
    return { ...f, embed, create };
  }

  it("records with the session instead of a key, filing nothing: preset resolved from the partner's template", async () => {
    const f = embedFixture();
    const response = await f.create();
    expect(response.status).toBe(200);
    const { consultationId } = (await response.json()) as { consultationId: string };
    expect(f.deps.create).toHaveBeenCalledWith(
      expect.objectContaining({
        partnerId: "partner-a",
        tenantId: "tenant-a1",
        externalUserId: "embed",
        template: "structured",
        retentionDays: 14,
        context: {
          clientId: "client-1",
          output: { task: "Fill the anamnesis", schema: SCHEMA },
        },
      }),
    );
    // The same pipeline: chunks, finish, then the status the page polls.
    const chunk = await f.embed(`${EMBED}/${consultationId}/chunks/0`, {
      method: "PUT",
      headers: { "content-type": "audio/webm;codecs=opus" },
      body: new Uint8Array([1, 2]),
    });
    expect(chunk.status).toBe(200);
    const finish = await f.embed(`${EMBED}/${consultationId}/finish`, { method: "POST" });
    expect(await finish.json()).toEqual({ state: "processing" });
    expect(f.enqueued).toEqual([consultationId]);
    f.rows.get(consultationId)!.state = "drafted";
    const status = await f.embed(`${EMBED}/${consultationId}`);
    expect(await status.json()).toMatchObject({
      state: "drafted",
      transcript: [expect.objectContaining({ text: "Bom dia." })],
    });
  });

  it("answers 401 without a session on every route, and never reaches a consultation of another customer", async () => {
    const f = embedFixture();
    const { consultationId } = (await (await f.create()).json()) as { consultationId: string };
    for (const [method, path] of [
      ["POST", EMBED],
      ["PUT", `${EMBED}/${consultationId}/chunks/0`],
      ["POST", `${EMBED}/${consultationId}/finish`],
      ["POST", `${EMBED}/${consultationId}/reprocess`],
      ["GET", `${EMBED}/${consultationId}`],
      ["DELETE", `${EMBED}/${consultationId}`],
      ["POST", `${EMBED}/${consultationId}/actions/apply`],
    ] as const) {
      expect((await f.embed(path, { method }, null)).status, path).toBe(401);
      expect((await f.embed(path, { method }, "wrong")).status, path).toBe(401);
    }
    // A consultation of the partner's other customer is not found with this session.
    f.rows.get(consultationId)!.tenantId = "tenant-other";
    expect((await f.embed(`${EMBED}/${consultationId}`)).status).toBe(404);
  });

  it("applies approved actions as the signed-in person, on the same routes", async () => {
    const f = embedFixture();
    const { consultationId } = (await (await f.create()).json()) as { consultationId: string };
    f.rows.get(consultationId)!.state = "drafted";
    const response = await f.embed(`${EMBED}/${consultationId}/actions/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actionIds: ["a1"] }),
    });
    expect(response.status).toBe(200);
    expect(f.applyCalls[0]?.caller).toEqual({ userId: "session-user" });
  });

  it("refuses to start without credit, like the partner's own recording does", async () => {
    const f = embedFixture();
    vi.mocked(f.deps.hasCredit).mockResolvedValueOnce(false);
    const response = await f.create();
    expect(response.status).toBe(402);
  });

  it("validates what a structured recording asks for", async () => {
    const f = embedFixture();
    // Unknown preset, a structured recording with no output, and an output on a template.
    expect(
      (await f.create({ context: { clientId: "c", output: { preset: "nope" } } })).status,
    ).toBe(400);
    expect((await f.create({ context: { clientId: "c" } })).status).toBe(400);
    expect(
      (
        await f.create({
          template: CONSULTATION_TEMPLATES[0],
          context: { clientId: "c", output: { task: "x" } },
        })
      ).status,
    ).toBe(400);
    // A schema the page registered itself is accepted as sent; a remote reference is not.
    expect(
      (
        await f.create({
          context: { clientId: "c", output: { task: "Evolution", schema: SCHEMA } },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await f.create({
          context: {
            clientId: "c",
            output: {
              task: "x",
              schema: { type: "object", properties: { a: { $ref: "https://evil.example/s" } } },
            },
          },
        })
      ).status,
    ).toBe(400);
  });

  it("also lets the partner's server ask for a structured recording with its key", async () => {
    const f = fixture();
    const response = await f.create({
      template: "structured",
      context: { clientId: "client-1", output: { task: "Evolution", schema: SCHEMA } },
    });
    expect(response.consultationId).toBeTruthy();
    expect(f.deps.create).toHaveBeenCalledWith(
      expect.objectContaining({ externalUserId: "doctor-1", template: "structured" }),
    );
  });
});
