import * as logging from "@corvo/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptionOutcome } from "./audio-transcription.js";
import {
  type ConsultationJobDeps,
  type ConsultationRecord,
  type ConsultationStore,
  CreditsExhaustedError,
  processConsultation,
  readConsultationResult,
  type ToolOutcome,
} from "./consultation-job.js";

const SECRET_WORDS = ["Maria Souza", "enxaqueca", "Dipirona"];

const baseRecord = (over: Partial<ConsultationRecord> = {}): ConsultationRecord => ({
  id: "cons-1",
  partnerId: "partner-1",
  tenantId: "tenant-1",
  spaceId: "space-1",
  ownerUserId: "owner-1",
  state: "processing",
  template: "prontu_evolution",
  context: {
    clientId: "client-1",
    appointmentId: "appt-1",
    professionalName: "Dr. Lima",
    clientName: "Maria Souza",
  },
  createdAt: new Date("2026-12-01T10:00:00.000Z"),
  resultArtifactId: null,
  purgedAt: null,
  ...over,
});

function fixture(
  options: {
    record?: Partial<ConsultationRecord>;
    chunks?: number;
    transcribe?: ConsultationJobDeps["transcribe"];
    complete?: ConsultationJobDeps["complete"];
    callTool?: ConsultationJobDeps["callTool"];
    setResultAccepted?: boolean;
  } = {},
) {
  let record = baseRecord(options.record);
  const objects = new Map<string, Uint8Array>();
  const chunkCount = options.chunks ?? 3;
  const chunkRows = Array.from({ length: chunkCount }, (_, seq) => ({
    seq,
    artifactId: `object:chunk-${seq}`,
    mimeType: "audio/webm",
  }));
  for (const [i, row] of chunkRows.entries()) {
    objects.set(row.artifactId, new Uint8Array([i + 1, i + 1]));
  }
  const settled: unknown[] = [];
  const store: ConsultationStore = {
    load: vi.fn(async () => record),
    chunks: vi.fn(async () => chunkRows),
    setResult: vi.fn(async (_id, artifactId) => {
      if (options.setResultAccepted === false) return false;
      record = { ...record, resultArtifactId: artifactId };
      return true;
    }),
    settle: vi.fn(async (_id, outcome) => {
      settled.push(outcome);
      return true;
    }),
  };
  let n = 0;
  const artifacts = {
    get: vi.fn(async (id: string) => {
      const bytes = objects.get(id);
      if (!bytes) throw new Error("missing");
      return bytes;
    }),
    put: vi.fn(async (artifact: { bytes: Uint8Array }) => {
      const id = `object:result-${++n}`;
      objects.set(id, artifact.bytes);
      return { id, hash: "" };
    }),
    remove: vi.fn(async (id: string) => {
      objects.delete(id);
    }),
  };
  const transcribe =
    options.transcribe ??
    vi.fn(
      async (): Promise<TranscriptionOutcome> => ({
        status: "transcribed",
        text: "Bom dia, Maria Souza. Estou com enxaqueca desde segunda-feira. Vou prescrever Dipirona 500 mg.",
      }),
    );
  const complete =
    options.complete ??
    vi.fn(async (_record, call) =>
      call.tier === "fast"
        ? '["p","c","p"]'
        : JSON.stringify({
            title: "Consulta",
            notes: "Paciente com enxaqueca.",
            chiefComplaint: "Enxaqueca",
            prescriptions: ["Dipirona 500 mg"],
          }),
    );
  const callTool =
    options.callTool ??
    vi.fn(async (_record, tool): Promise<ToolOutcome> => {
      if (tool === "mcp_records_get_by_client") {
        return { ok: true, data: { structuredContent: { recordId: "rec-7", status: "open" } } };
      }
      if (tool === "mcp_records_entries_list") {
        return { ok: true, data: { structuredContent: { items: [], nextCursor: null } } };
      }
      return {
        ok: true,
        data: {
          content: [{ type: "text", text: JSON.stringify({ entryId: "entry-9", revision: 1 }) }],
        },
      };
    });
  const audit = vi.fn();
  const deps: ConsultationJobDeps = {
    store,
    artifacts,
    transcribe,
    complete,
    callTool,
    audit,
    sleep: async () => undefined,
  };
  return {
    deps,
    store,
    artifacts,
    objects,
    settled,
    transcribe,
    complete,
    callTool,
    audit,
    record: () => record,
  };
}

const logged: unknown[][] = [];
beforeEach(() => {
  logged.length = 0;
  const log = (...args: unknown[]) => void logged.push(args);
  vi.spyOn(logging, "getLogger").mockReturnValue({
    debug: log,
    info: log,
    warn: log,
    error: log,
  } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("processConsultation", () => {
  it("drafts the note: transcribes, labels, fills the template and files it with the record connector", async () => {
    const f = fixture();
    await processConsultation(f.deps, "cons-1");

    expect(f.callTool).toHaveBeenNthCalledWith(1, expect.anything(), "mcp_records_get_by_client", {
      clientId: "client-1",
      appointmentId: "appt-1",
    });
    expect(f.callTool).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "mcp_records_entries_create_draft",
      {
        recordId: "rec-7",
        entryTypeCode: "evolution",
        content: {
          schemaVersion: 1,
          title: "Consulta",
          notes:
            "Paciente com enxaqueca.\n\nQueixa principal:\nEnxaqueca\n\nPrescrições:\n- Dipirona 500 mg",
          chiefComplaint: "Enxaqueca",
          history: "",
          exam: "",
          assessment: "",
          plan: "",
          prescriptions: ["Dipirona 500 mg"],
          followUp: "",
          appointmentId: "appt-1",
        },
        occurredAt: "2026-12-01T10:00:00.000Z",
        appointmentId: "appt-1",
        source: "ai_scribe",
        consultationId: "cons-1",
        idempotencyKey: "cons-1",
      },
    );
    expect(f.settled).toEqual([
      expect.objectContaining({ state: "drafted", draftEntryId: "entry-9" }),
    ]);
    // Labels on the fast tier, the note on the strong one.
    expect(f.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "fast", operation: "consultation-labels" }),
    );
    expect(f.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tier: "strong", operation: "consultation-note" }),
    );
    // The result is sealed in storage with speaker turns and the note; the older checkpoint is gone.
    const result = await readConsultationResult(f.deps, f.record());
    expect(result?.turns.map((t) => t.speaker)).toEqual(["professional", "patient"]);
    expect(result?.note).toMatchObject({ title: "Consulta" });
    expect([...f.objects.keys()].filter((key) => key.includes("result"))).toHaveLength(1);
  });

  it("concatenates the chunks in order before transcribing", async () => {
    const f = fixture({ chunks: 3 });
    await processConsultation(f.deps, "cons-1");
    expect(f.transcribe).toHaveBeenCalledTimes(1);
    const call = vi.mocked(f.transcribe).mock.calls[0];
    expect([...(call?.[1].audio ?? [])]).toEqual([1, 1, 2, 2, 3, 3]);
    expect(call?.[1].mimeType).toBe("audio/webm");
  });

  it("files a salon service record under its own entry type", async () => {
    const f = fixture({ record: { template: "salon_service_record" } });
    vi.mocked(f.complete).mockImplementation(async (_r, call) =>
      call.tier === "fast" ? '["p","c","p"]' : '{"title":"Corte","servicesDone":"Corte e barba"}',
    );
    await processConsultation(f.deps, "cons-1");
    expect(f.callTool).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "mcp_records_entries_create_draft",
      expect.objectContaining({
        entryTypeCode: "service_record",
        content: expect.objectContaining({ servicesDone: "Corte e barba", schemaVersion: 1 }),
      }),
    );
  });

  it("updates the unsigned draft the record already holds for the appointment", async () => {
    const f = fixture();
    vi.mocked(f.callTool).mockImplementation(async (_r, tool) => {
      const data: Record<string, unknown> = {
        mcp_records_get_by_client: {
          recordId: "rec-7",
          existingDraft: { entryId: "mine", revision: 4 },
        },
        mcp_records_entries_update_draft: { entryId: "mine", revision: 5 },
      };
      return { ok: true, data: { structuredContent: data[tool] } };
    });
    await processConsultation(f.deps, "cons-1");
    const tools = vi.mocked(f.callTool).mock.calls.map((call) => call[1]);
    expect(tools).toEqual(["mcp_records_get_by_client", "mcp_records_entries_update_draft"]);
    expect(f.callTool).toHaveBeenLastCalledWith(
      expect.anything(),
      "mcp_records_entries_update_draft",
      expect.objectContaining({
        recordId: "rec-7",
        entryId: "mine",
        expectedRevision: 4,
        idempotencyKey: "cons-1:update:4",
      }),
    );
    expect(f.settled).toEqual([
      expect.objectContaining({ state: "drafted", draftEntryId: "mine" }),
    ]);
  });

  it("falls back to an update when creating finds a draft made meanwhile", async () => {
    const f = fixture();
    let lookups = 0;
    vi.mocked(f.callTool).mockImplementation(async (_r, tool): Promise<ToolOutcome> => {
      if (tool === "mcp_records_get_by_client") {
        lookups += 1;
        return {
          ok: true,
          data: {
            structuredContent: {
              recordId: "rec-7",
              existingDraft: lookups > 1 ? { entryId: "raced", revision: 2 } : null,
            },
          },
        };
      }
      if (tool === "mcp_records_entries_create_draft") {
        return { ok: false, message: "MCP_RECORDS_DRAFT_EXISTS entry raced revision 2" };
      }
      return { ok: true, data: { structuredContent: { entryId: "raced", revision: 3 } } };
    });
    await processConsultation(f.deps, "cons-1");
    expect(f.settled).toEqual([
      expect.objectContaining({ state: "drafted", draftEntryId: "raced" }),
    ]);
  });

  it("splits a long recording into segments, transcribes them together and stitches them in order", async () => {
    const f = fixture({ chunks: 1 });
    const header = [0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4];
    const cluster = (n: number) =>
      new Uint8Array([0x1f, 0x43, 0xb6, 0x75, ...new Uint8Array(1024 * 1024).fill(n)]);
    const parts = [new Uint8Array(header), ...Array.from({ length: 20 }, (_, i) => cluster(i + 1))];
    const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      whole.set(part, offset);
      offset += part.length;
    }
    f.objects.set("object:chunk-0", whole);
    vi.mocked(f.transcribe).mockImplementation(async (_r, input) => {
      // The first cluster of the segment tells which part of the recording it is.
      const first = input.audio[input.audio.length > 0 ? header.length + 4 : 0] ?? 0;
      return { status: "transcribed", text: `Parte que começa no bloco ${first}. Fim dela.` };
    });
    await processConsultation(f.deps, "cons-1");
    expect(f.transcribe).toHaveBeenCalledTimes(3);
    const result = await readConsultationResult(f.deps, f.record());
    const text = result?.turns.map((turn) => turn.text).join(" ") ?? "";
    const blocks = [...text.matchAll(/bloco (\d+)/g)].map((match) => Number(match[1]));
    expect(blocks).toEqual([...blocks].sort((a, b) => a - b));
    expect(blocks[0]).toBe(1);
    const starts = result?.turns.map((turn) => turn.startMs) ?? [];
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(f.settled[0]).toMatchObject({ state: "drafted" });
  });

  it("leaves speakers unknown when labeling fails, and still drafts", async () => {
    const f = fixture();
    vi.mocked(f.complete).mockImplementation(async (_r, call) => {
      if (call.tier === "fast") throw new Error("label model down");
      return '{"title":"Consulta","notes":"Texto."}';
    });
    await processConsultation(f.deps, "cons-1");
    const result = await readConsultationResult(f.deps, f.record());
    expect(result?.turns.every((t) => t.speaker === "unknown")).toBe(true);
    expect(f.settled[0]).toMatchObject({ state: "drafted" });
  });

  describe("failure codes", () => {
    it("no_audio when nothing was uploaded", async () => {
      const f = fixture({ chunks: 0 });
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "no_audio" }]);
      expect(f.transcribe).not.toHaveBeenCalled();
    });

    it("no_speech when the recording is silent", async () => {
      const f = fixture({
        transcribe: vi.fn(async () => ({ status: "failed", reason: "no-speech" }) as const),
      });
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "no_speech" }]);
    });

    it("transcription_failed after the provider keeps failing, retrying first", async () => {
      const transcribe = vi.fn(
        async () => ({ status: "failed", reason: "provider-failed" }) as const,
      );
      const f = fixture({ transcribe });
      await processConsultation(f.deps, "cons-1");
      expect(transcribe).toHaveBeenCalledTimes(3);
      expect(f.settled).toEqual([{ state: "failed", errorCode: "transcription_failed" }]);
    });

    it("credit_exhausted when the transcription hold is refused, without retrying", async () => {
      const transcribe = vi.fn(
        async () => ({ status: "failed", reason: "credits-used-up" }) as const,
      );
      const f = fixture({ transcribe });
      await processConsultation(f.deps, "cons-1");
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(f.settled).toEqual([{ state: "failed", errorCode: "credit_exhausted" }]);
    });

    it("credit_exhausted when the model's credit runs out", async () => {
      const f = fixture();
      vi.mocked(f.complete).mockImplementation(async (_r, call) => {
        if (call.tier === "strong") throw new CreditsExhaustedError();
        return '["p","c","p"]';
      });
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "credit_exhausted" }]);
      expect(f.callTool).not.toHaveBeenCalled();
    });

    it("model_failed when the answer holds no note, keeping the transcript for a retry", async () => {
      const f = fixture();
      vi.mocked(f.complete).mockImplementation(async (_r, call) =>
        call.tier === "fast" ? '["p","c","p"]' : "Não consigo ajudar.",
      );
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "model_failed" }]);
      expect((await readConsultationResult(f.deps, f.record()))?.note).toBeUndefined();
    });

    it("record_not_found when the connector has no record for the client", async () => {
      const f = fixture({
        callTool: vi.fn(async () => ({ ok: true, data: { structuredContent: {} } }) as const),
      });
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "record_not_found" }]);
    });

    it("connector_failed when the connector keeps erroring", async () => {
      const callTool = vi.fn(async () => ({ ok: false }) as const);
      const f = fixture({ callTool });
      await processConsultation(f.deps, "cons-1");
      expect(callTool).toHaveBeenCalledTimes(3);
      expect(f.settled).toEqual([{ state: "failed", errorCode: "connector_failed" }]);
    });

    it("connector_failed when the draft answer carries no entry id", async () => {
      const f = fixture({
        callTool: vi.fn(async (_r, tool) =>
          tool === "mcp_records_get_by_client"
            ? ({ ok: true, data: { structuredContent: { recordId: "rec-7" } } } as const)
            : ({ ok: true, data: { structuredContent: { revision: 1 } } } as const),
        ),
      });
      await processConsultation(f.deps, "cons-1");
      expect(f.settled).toEqual([{ state: "failed", errorCode: "connector_failed" }]);
    });
  });

  it("does nothing for a consultation that is gone, deleted or not processing", async () => {
    for (const record of [{ purgedAt: new Date() }, { state: "recording" }, { state: "drafted" }]) {
      const f = fixture({ record });
      await processConsultation(f.deps, "cons-1");
      expect(f.transcribe).not.toHaveBeenCalled();
      expect(f.settled).toEqual([]);
    }
    const f = fixture();
    vi.mocked(f.store.load).mockResolvedValue(null);
    await processConsultation(f.deps, "cons-1");
    expect(f.transcribe).not.toHaveBeenCalled();
  });

  it("resumes from the sealed transcript and note instead of paying for them again", async () => {
    const first = fixture({
      callTool: vi.fn(async () => ({ ok: false }) as const),
    });
    await processConsultation(first.deps, "cons-1");
    expect(first.settled).toEqual([{ state: "failed", errorCode: "connector_failed" }]);
    // A worker that died after the note was sealed starts again from the stored result.
    const second = fixture({ record: { resultArtifactId: first.record().resultArtifactId } });
    for (const [id, bytes] of first.objects) second.objects.set(id, bytes);
    await processConsultation(second.deps, "cons-1");
    expect(second.transcribe).not.toHaveBeenCalled();
    expect(second.complete).not.toHaveBeenCalled();
    expect(second.settled).toEqual([expect.objectContaining({ state: "drafted" })]);
  });

  it("leaves nothing behind when the consultation is deleted while it is processed", async () => {
    const f = fixture({ setResultAccepted: false });
    await processConsultation(f.deps, "cons-1");
    expect([...f.objects.keys()].filter((key) => key.includes("result"))).toEqual([]);
    expect(f.callTool).not.toHaveBeenCalled();
  });

  it("writes no audio, transcript, name or note into the logs, even when an error message holds them", async () => {
    const f = fixture();
    vi.mocked(f.complete).mockImplementation(async (_r, call) => {
      if (call.tier === "strong") throw new Error("Maria Souza enxaqueca Dipirona");
      return '["p","c","p"]';
    });
    await processConsultation(f.deps, "cons-1");
    expect(f.settled).toEqual([{ state: "failed", errorCode: "model_failed" }]);
    expect(logged.length).toBeGreaterThan(0);
    const text = JSON.stringify(logged);
    for (const word of SECRET_WORDS) expect(text).not.toContain(word);
    expect(f.audit.mock.calls.every(([event]) => !JSON.stringify(event).includes("Maria"))).toBe(
      true,
    );
  });
});
