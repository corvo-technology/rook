import { z } from "zod";
import { ConsultationOutput } from "./assist.js";

/** The forms a partner's consultation recording can fill. */
export const CONSULTATION_TEMPLATES = ["prontu_evolution", "salon_service_record"] as const;
export const ConsultationTemplate = z.enum(CONSULTATION_TEMPLATES);
export type ConsultationTemplate = z.infer<typeof ConsultationTemplate>;

export const CONSULTATION_STATES = ["recording", "processing", "drafted", "failed"] as const;
export const ConsultationState = z.enum(CONSULTATION_STATES);
export type ConsultationState = z.infer<typeof ConsultationState>;

/** Why a consultation failed, for the partner to act on. Never carries content. */
export const CONSULTATION_ERROR_CODES = [
  "no_audio",
  "transcription_failed",
  /** No speech-to-text is set up for the customer; the partner's administrators are told. */
  "transcription_unavailable",
  "no_speech",
  "credit_exhausted",
  "model_failed",
  "connector_failed",
  "record_not_found",
  "internal",
] as const;
export const ConsultationErrorCode = z.enum(CONSULTATION_ERROR_CODES);
export type ConsultationErrorCode = z.infer<typeof ConsultationErrorCode>;

export const CONSULTATION_CHUNK_MAX_BYTES = 2 * 1024 * 1024;
/** Chunks are about ten seconds each; 540 of them is a ninety-minute visit. */
export const CONSULTATION_CHUNK_SECONDS = 10;
export const CONSULTATION_MAX_CHUNKS = 540;
export const CONSULTATION_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
export const CONSULTATION_AUDIO_TYPES = ["audio/webm", "audio/ogg"] as const;
export const CONSULTATION_DEFAULT_RETENTION_DAYS = 30;
export const CONSULTATION_MAX_RETENTION_DAYS = 365;

const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_.:-]+$/);

/**
 * A recording that fills no template and files nothing in the partner's system: it returns the
 * fields of a schema the partner's page registered, for the professional to review in its own form.
 */
export const CONSULTATION_STRUCTURED = "structured" as const;

const consultationFields = {
  template: z.union([ConsultationTemplate, z.literal(CONSULTATION_STRUCTURED)]),
  context: z
    .object({
      clientId: Id,
      appointmentId: Id.optional(),
      professionalName: z.string().trim().max(120).optional(),
      clientName: z.string().trim().max(120).optional(),
      /** What a structured recording must produce; only for that template. */
      output: ConsultationOutput.optional(),
    })
    .strict(),
  consent: z
    .object({
      obtained: z.literal(true),
      at: z.string().datetime({ offset: true }),
      method: z.enum(["verbal", "written"]),
      text: z.string().max(2000).optional(),
    })
    .strict(),
  retentionDays: z.number().int().min(1).max(CONSULTATION_MAX_RETENTION_DAYS).optional(),
};

const outputMatchesTemplate = (input: {
  template: string;
  context: { output?: unknown };
}): boolean => (input.template === CONSULTATION_STRUCTURED) === Boolean(input.context.output);

export const ConsultationCreateInput = z
  .object({ externalUserId: Id, ...consultationFields })
  .strict()
  .refine(outputMatchesTemplate, { message: "Only a structured recording names its output" });
export type ConsultationCreateInput = z.infer<typeof ConsultationCreateInput>;

/** From an embedded page: the person is the signed-in session, so no user id is sent. */
export const EmbedConsultationCreateInput = z
  .object({ externalUserId: Id.optional(), ...consultationFields })
  .strict()
  .refine(outputMatchesTemplate, { message: "Only a structured recording names its output" });
export type EmbedConsultationCreateInput = z.infer<typeof EmbedConsultationCreateInput>;

export const ConsultationSpeaker = z.enum(["professional", "patient", "unknown"]);
export type ConsultationSpeaker = z.infer<typeof ConsultationSpeaker>;

export const ConsultationTurn = z.object({
  speaker: ConsultationSpeaker,
  startMs: z.number().int().min(0),
  text: z.string(),
});
export type ConsultationTurn = z.infer<typeof ConsultationTurn>;

export const ConsultationStatus = z.object({
  state: ConsultationState,
  transcript: z.array(ConsultationTurn).optional(),
  note: z.record(z.string(), z.unknown()).optional(),
  draftEntryId: z.string().optional(),
  error: z.object({ code: ConsultationErrorCode }).optional(),
});
export type ConsultationStatus = z.infer<typeof ConsultationStatus>;
