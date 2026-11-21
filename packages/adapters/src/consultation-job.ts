import type { ArtifactStore } from "@corvo/adapter-kit";
import type {
  ConsultationAction,
  ConsultationActionTools,
  ConsultationErrorCode,
  ConsultationOutput,
  ConsultationTemplate,
  ConsultationTurn,
} from "@corvo/contracts";
import {
  CONSULTATION_STRUCTURED,
  ConsultationAction as ConsultationActionSchema,
  ConsultationTurn as ConsultationTurnSchema,
} from "@corvo/contracts";
import { getLogger } from "@corvo/logging";
import { z } from "zod";
import type { TranscriptionOutcome } from "./audio-transcription.js";
import {
  actionsInstructions,
  annotateChecks,
  buildActionsPrompt,
  DEFAULT_ACTIONS_TIMEZONE,
  parseActions,
  type ResolvedActionTools,
} from "./consultation-actions.js";
import { concatBytes, planAudioSegments } from "./consultation-audio.js";
import {
  buildLabelPrompt,
  buildScribePrompt,
  type ConsultationContext,
  draftContent,
  ENTRY_TYPE_CODE,
  LABEL_INSTRUCTIONS,
  LABEL_WINDOW_LINES,
  mergeTurns,
  parseLabels,
  parseNote,
  scribeInstructions,
  type TranscriptUnit,
  transcriptUnits,
} from "./consultation-scribe.js";
import { runStructuredAssist } from "./structured-assist.js";

export interface ConsultationRecord {
  id: string;
  partnerId: string;
  tenantId: string;
  /** The customer's space and the one owner every call runs as. */
  spaceId: string;
  ownerUserId: string;
  state: string;
  template: ConsultationTemplate | typeof CONSULTATION_STRUCTURED;
  context: ConsultationContext & { clientId: string; output?: ConsultationOutput };
  createdAt: Date;
  resultArtifactId: string | null;
  purgedAt: Date | null;
  /** The clinic's IANA timezone, from the recording, the customer or the partner's template. */
  timezone?: string;
  /** Tool names the partner's template sets for actions, over the lookup by name. */
  actionToolOverride?: ConsultationActionTools;
}

export interface ConsultationStore {
  load(id: string): Promise<ConsultationRecord | null>;
  chunks(id: string): Promise<Array<{ seq: number; artifactId: string; mimeType: string }>>;
  /** Points the consultation at its newest sealed result. */
  setResult(id: string, artifactId: string): Promise<boolean>;
  settle(
    id: string,
    outcome:
      | { state: "drafted"; draftEntryId: string | null; resultArtifactId: string }
      | { state: "failed"; errorCode: ConsultationErrorCode },
  ): Promise<boolean>;
}

export type ToolOutcome = { ok: true; data: unknown } | { ok: false; message?: string };

export interface ConsultationJobDeps {
  store: ConsultationStore;
  artifacts: Pick<ArtifactStore, "get" | "put" | "remove">;
  transcribe(
    record: ConsultationRecord,
    input: { audio: Uint8Array; mimeType: string },
  ): Promise<TranscriptionOutcome>;
  /** One tool-less model call on the customer's models; throws {@link CreditsExhaustedError} when its credit is used up. */
  complete(
    record: ConsultationRecord,
    call: { tier: "fast" | "strong"; operation: string; instructions: string; prompt: string },
  ): Promise<string | undefined>;
  /** One tool call on the customer's record connector, with the connector's own authorization. */
  callTool(
    record: ConsultationRecord,
    tool: string,
    args: Record<string, unknown>,
    options?: { requestedByUserId?: string },
  ): Promise<ToolOutcome>;
  /** Tells the partner's administrators the real cause of a setup failure; best effort. */
  onSetupFailure?(record: ConsultationRecord, cause: "transcription_unavailable"): Promise<void>;
  /** The connector's tools that check and carry out actions; absent when it cannot be listed. */
  actionTools?(record: ConsultationRecord): Promise<ResolvedActionTools>;
  /** Content-free audit of what the pipeline did. */
  audit(event: { type: "consultation.accessed"; consultationId: string; outcome: string }): void;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export class CreditsExhaustedError extends Error {
  constructor() {
    super("The customer's credit is used up.");
    this.name = "CreditsExhaustedError";
  }
}

/** A step that failed for a reason the partner can act on; the code is all that is kept. */
class StepFailure extends Error {
  constructor(readonly code: ConsultationErrorCode) {
    super(code);
  }
}

const RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const TRANSCRIBE_CONCURRENCY = 4;
const LABEL_CONCURRENCY = 3;
const RESULT_VERSION = 1;

const Result = z.object({
  version: z.literal(RESULT_VERSION),
  turns: z.array(ConsultationTurnSchema),
  note: z.record(z.string(), z.unknown()).optional(),
  /** What was agreed to do next; absent until extracted, an empty list when nothing was agreed. */
  actions: z.array(ConsultationActionSchema).optional(),
});
export type ConsultationResult = z.infer<typeof Result>;

/** Reads a sealed result back; an unreadable one is treated as absent so the step is redone. */
export async function readConsultationResult(
  deps: Pick<ConsultationJobDeps, "artifacts">,
  record: Pick<ConsultationRecord, "spaceId" | "ownerUserId" | "resultArtifactId">,
): Promise<ConsultationResult | null> {
  if (!record.resultArtifactId) return null;
  try {
    const bytes = await deps.artifacts.get(record.resultArtifactId, artifactContext(record));
    return Result.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function artifactContext(record: Pick<ConsultationRecord, "spaceId" | "ownerUserId">) {
  return {
    operationId: "consultation",
    traceId: "consultation",
    spaceId: record.spaceId,
    userId: record.ownerUserId,
    signal: AbortSignal.timeout(60_000),
  };
}

async function pool<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Turns one finished recording into a draft note, step by step: transcribe, label speakers, fill
 * the template, file the draft through the customer's connector. What is kept between steps is
 * sealed, so a retry or a restarted worker resumes instead of paying again. Audio, transcript and
 * note stay inside the configured transcription and model providers and the customer's own
 * connector; nothing here logs them.
 */
export async function processConsultation(
  deps: ConsultationJobDeps,
  consultationId: string,
): Promise<void> {
  const record = await deps.store.load(consultationId);
  if (!record || record.purgedAt || record.state !== "processing") return;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retry = async <T>(step: () => Promise<T>, code?: ConsultationErrorCode): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await step();
      } catch (error) {
        if (error instanceof StepFailure || error instanceof CreditsExhaustedError) throw error;
        if (attempt >= RETRIES) throw code ? new StepFailure(code) : error;
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  };
  let sealed: string | null = record.resultArtifactId;
  const seal = async (result: ConsultationResult) => {
    const stored = await deps.artifacts.put(
      {
        name: "consultation-result",
        mimeType: "application/json",
        bytes: new TextEncoder().encode(JSON.stringify(result)),
      },
      artifactContext(record),
    );
    const previous = sealed;
    sealed = stored.id;
    if (!(await deps.store.setResult(record.id, stored.id))) {
      // The consultation was deleted while it was being processed: leave nothing behind.
      await deps.artifacts.remove(stored.id, artifactContext(record)).catch(() => undefined);
      throw new StepFailure("internal");
    }
    if (previous)
      await deps.artifacts.remove(previous, artifactContext(record)).catch(() => undefined);
  };

  try {
    let result = await readConsultationResult(deps, record);
    if (!result) {
      const turns = await transcribeAndLabel(deps, record, retry);
      result = { version: RESULT_VERSION, turns };
      await seal(result);
    }
    if (!result.note) {
      const note = await retry(() => writeNote(deps, record, result?.turns ?? []), "model_failed");
      result = { ...result, note };
      await seal(result);
    }
    if (!result.actions) {
      const actions = await extractActions(deps, record, result.turns, retry);
      result = { ...result, actions };
      await seal(result);
    }
    // A structured recording files nothing: the page that asked fills its own form from the note.
    const draftEntryId =
      record.template === CONSULTATION_STRUCTURED
        ? null
        : await retry(() => fileDraft(deps, record, result?.note ?? {}), "connector_failed");
    if (!sealed) throw new StepFailure("internal");
    const settled = await deps.store.settle(record.id, {
      state: "drafted",
      draftEntryId,
      resultArtifactId: sealed,
    });
    deps.audit({
      type: "consultation.accessed",
      consultationId: record.id,
      outcome: settled ? "drafted" : "discarded",
    });
  } catch (error) {
    const code: ConsultationErrorCode =
      error instanceof StepFailure
        ? error.code
        : error instanceof CreditsExhaustedError
          ? "credit_exhausted"
          : "internal";
    // The message of an unexpected error can carry content; only its class is logged.
    getLogger().warn("consultation failed", {
      "consultation.id": record.id,
      "consultation.error": code,
      "error.type": error instanceof Error ? error.name : "unknown",
    });
    if (code === "transcription_unavailable") {
      await deps.onSetupFailure?.(record, "transcription_unavailable").catch(() => undefined);
    }
    await deps.store.settle(record.id, { state: "failed", errorCode: code });
    deps.audit({ type: "consultation.accessed", consultationId: record.id, outcome: code });
  }
}

async function transcribeAndLabel(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
  retry: <T>(step: () => Promise<T>, code?: ConsultationErrorCode) => Promise<T>,
): Promise<ConsultationTurn[]> {
  const chunks = await deps.store.chunks(record.id);
  if (chunks.length === 0) throw new StepFailure("no_audio");
  const parts = await Promise.all(
    chunks.map((chunk) => deps.artifacts.get(chunk.artifactId, artifactContext(record))),
  );
  const mimeType = chunks[0]?.mimeType ?? "audio/webm";
  const segments = planAudioSegments(concatBytes(parts), mimeType, chunks.length);
  const heard = await pool(segments, TRANSCRIBE_CONCURRENCY, (segment) =>
    retry(async () => {
      const outcome = await deps.transcribe(record, { audio: segment.bytes, mimeType });
      if (outcome.status === "transcribed") return outcome.text;
      if (outcome.reason === "credits-used-up") throw new CreditsExhaustedError();
      // Silence is a finding about the recording, not a fault to retry.
      if (outcome.reason === "no-speech") return "";
      // Nothing set up to listen with: retrying cannot help, and the partner is told.
      if (outcome.reason === "not-configured") throw new StepFailure("transcription_unavailable");
      // The reason is one of a fixed list, never content, so it is safe to keep.
      getLogger().warn("consultation transcription failed", {
        "consultation.id": record.id,
        "transcription.reason": outcome.reason,
      });
      throw new Error("transcription failed");
    }, "transcription_failed"),
  );
  const units: TranscriptUnit[] = segments.flatMap((segment, i) =>
    transcriptUnits({
      text: heard[i] ?? "",
      startMs: segment.startMs,
      durationMs: segment.durationMs,
    }),
  );
  if (units.length === 0) throw new StepFailure("no_speech");
  const windows: TranscriptUnit[][] = [];
  for (let i = 0; i < units.length; i += LABEL_WINDOW_LINES) {
    windows.push(units.slice(i, i + LABEL_WINDOW_LINES));
  }
  const labelled = await pool(windows, LABEL_CONCURRENCY, async (window) => {
    try {
      const answer = await deps.complete(record, {
        tier: "fast",
        operation: "consultation-labels",
        instructions: LABEL_INSTRUCTIONS,
        prompt: buildLabelPrompt(
          window.map((unit) => unit.text),
          record.context,
        ),
      });
      return parseLabels(answer, window.length);
    } catch (error) {
      if (error instanceof CreditsExhaustedError) throw error;
      // Who said what is helpful, not essential: the note can still be written without it.
      return parseLabels(undefined, window.length);
    }
  });
  return mergeTurns(units, labelled.flat());
}

/**
 * What the conversation agreed to do next. A model that fails, or answers with nothing usable,
 * leaves the consultation without actions: the note and transcript are still the result.
 */
async function extractActions(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
  turns: readonly ConsultationTurn[],
  retry: <T>(step: () => Promise<T>, code?: ConsultationErrorCode) => Promise<T>,
): Promise<ConsultationAction[]> {
  const timeZone = record.timezone ?? DEFAULT_ACTIONS_TIMEZONE;
  try {
    const answer = await retry(() =>
      deps.complete(record, {
        tier: "fast",
        operation: "consultation-actions",
        instructions: actionsInstructions(),
        prompt: buildActionsPrompt(turns, {
          ...(record.context.professionalName
            ? { professionalName: record.context.professionalName }
            : {}),
          ...(record.context.clientName ? { clientName: record.context.clientName } : {}),
          consultedAt: record.createdAt,
          timeZone,
        }),
      }),
    );
    const actions = parseActions(answer, {
      turnCount: turns.length,
      timeZone,
      consultedAt: record.createdAt,
    });
    if (!actions.some((action) => action.kind === "follow_up") || !deps.actionTools) {
      return actions;
    }
    const tools = await deps.actionTools(record).catch(() => ({}) as ResolvedActionTools);
    return await annotateChecks(actions, (tool, args) => deps.callTool(record, tool, args), tools, {
      clientId: record.context.clientId,
      timeZone,
    });
  } catch (error) {
    if (error instanceof CreditsExhaustedError) throw error;
    getLogger().warn("consultation actions skipped", {
      "consultation.id": record.id,
      "error.type": error instanceof Error ? error.name : "unknown",
    });
    return [];
  }
}

async function writeNote(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
  turns: readonly ConsultationTurn[],
): Promise<Record<string, unknown>> {
  const template = record.template;
  if (template === CONSULTATION_STRUCTURED) return writeStructured(deps, record, turns);
  let answer: string | undefined;
  try {
    answer = await deps.complete(record, {
      tier: "strong",
      operation: "consultation-note",
      instructions: scribeInstructions(template),
      prompt: buildScribePrompt(turns, record.context),
    });
  } catch (error) {
    if (error instanceof CreditsExhaustedError) throw error;
    throw new Error("model failed");
  }
  const note = parseNote(template, answer);
  if (!note) throw new Error("model answered without a note");
  return note;
}

const SPEAKER_LABEL: Record<ConsultationTurn["speaker"], string> = {
  professional: "Profissional",
  patient: "Paciente",
  unknown: "?",
};

/** The fields of the schema the page registered, written from the transcript and checked against it. */
async function writeStructured(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
  turns: readonly ConsultationTurn[],
): Promise<Record<string, unknown>> {
  const output = record.context.output;
  const outcome = await runStructuredAssist(
    {
      complete: (call) => deps.complete(record, { tier: "strong", ...call }),
    },
    {
      task: output?.task ?? "Write the record of this consultation from its transcript.",
      ...(output?.instructions ? { instructions: output.instructions } : {}),
      ...(output?.schema ? { schema: output.schema } : {}),
      context: {
        ...(record.context.professionalName
          ? { professional: record.context.professionalName }
          : {}),
        ...(record.context.clientName ? { client: record.context.clientName } : {}),
      },
      material: {
        label: "Transcript",
        text: turns.map((turn) => `${SPEAKER_LABEL[turn.speaker]}: ${turn.text}`).join("\n"),
      },
    },
    "consultation-structured",
  ).catch((error: unknown) => {
    if (error instanceof CreditsExhaustedError) throw error;
    throw new Error("model failed");
  });
  // The model was asked twice already; asking again would only pay again for the same refusal.
  if (!outcome.ok) throw new StepFailure("model_failed");
  return outcome.result;
}

/** A failed call throws so the step is retried; an answer without the expected fields is the caller's to judge. */
function toolData(outcome: ToolOutcome): Record<string, unknown> {
  if (!outcome.ok) throw new Error("connector call failed");
  const data = outcome.data as {
    structuredContent?: unknown;
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  } | null;
  if (!data || data.isError) throw new Error("connector call failed");
  const structured = data.structuredContent;
  if (structured && typeof structured === "object") return structured as Record<string, unknown>;
  const text = data.content?.find((part) => part.type === "text")?.text;
  if (!text) throw new Error("connector call failed");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Falls through to the failure below.
  }
  throw new Error("connector call failed");
}

const TOOLS = {
  byClient: "mcp_records_get_by_client",
  create: "mcp_records_entries_create_draft",
  update: "mcp_records_entries_update_draft",
};

type Existing = { entryId: string; revision: number };

/** The record, and the unsigned AI draft already made for the appointment, when there is one. */
async function lookUpRecord(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
): Promise<{ recordId: string; existing: Existing | null }> {
  const found = toolData(
    await deps.callTool(record, TOOLS.byClient, {
      clientId: record.context.clientId,
      ...(record.context.appointmentId ? { appointmentId: record.context.appointmentId } : {}),
    }),
  );
  const recordId = typeof found.recordId === "string" ? found.recordId : undefined;
  if (!recordId) throw new StepFailure("record_not_found");
  const draft = found.existingDraft as { entryId?: unknown; revision?: unknown } | null | undefined;
  const existing =
    typeof draft?.entryId === "string" && typeof draft.revision === "number"
      ? { entryId: draft.entryId, revision: draft.revision }
      : null;
  return { recordId, existing };
}

async function fileDraft(
  deps: ConsultationJobDeps,
  record: ConsultationRecord,
  note: Record<string, unknown>,
): Promise<string> {
  const template = record.template;
  // A structured recording is never filed; the caller skips this step for it.
  if (template === CONSULTATION_STRUCTURED) throw new StepFailure("internal");
  const { recordId, existing } = await lookUpRecord(deps, record);
  const content = draftContent({
    template,
    note: note as Record<string, string | string[]>,
    ...(record.context.appointmentId ? { appointmentId: record.context.appointmentId } : {}),
  });
  const update = async (draft: Existing) => {
    const updated = toolData(
      await deps.callTool(record, TOOLS.update, {
        recordId,
        entryId: draft.entryId,
        expectedRevision: draft.revision,
        content,
        idempotencyKey: `${record.id}:update:${draft.revision}`,
      }),
    );
    if (typeof updated.entryId !== "string") throw new StepFailure("connector_failed");
    return updated.entryId;
  };
  if (existing) return update(existing);
  const outcome = await deps.callTool(record, TOOLS.create, {
    recordId,
    entryTypeCode: ENTRY_TYPE_CODE[template],
    content,
    occurredAt: record.createdAt.toISOString(),
    ...(record.context.appointmentId ? { appointmentId: record.context.appointmentId } : {}),
    source: "ai_scribe",
    consultationId: record.id,
    idempotencyKey: record.id,
  });
  // A draft made meanwhile for the same appointment is updated rather than duplicated.
  if (!outcome.ok && outcome.message?.includes("MCP_RECORDS_DRAFT_EXISTS")) {
    const again = await lookUpRecord(deps, record);
    if (again.existing) return update(again.existing);
  }
  const created = toolData(outcome);
  if (typeof created.entryId !== "string") throw new StepFailure("connector_failed");
  return created.entryId;
}
