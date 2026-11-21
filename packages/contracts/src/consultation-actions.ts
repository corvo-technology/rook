import { z } from "zod";

/** What a consultation can agree to do next. Only what was actually agreed is ever proposed. */
export const CONSULTATION_ACTION_KINDS = [
  "follow_up",
  "prescription",
  "exam_request",
  "certificate",
  "patient_message",
] as const;
export const ConsultationActionKind = z.enum(CONSULTATION_ACTION_KINDS);
export type ConsultationActionKind = z.infer<typeof ConsultationActionKind>;

/** `proposed` until the partner's page applies it; the other three are what applying came to. */
export const CONSULTATION_ACTION_STATUSES = ["proposed", "applied", "failed", "skipped"] as const;
export const ConsultationActionStatus = z.enum(CONSULTATION_ACTION_STATUSES);
export type ConsultationActionStatus = z.infer<typeof ConsultationActionStatus>;

/** The most actions one apply call may name. */
export const CONSULTATION_ACTIONS_MAX = 20;

const Text = z.string().trim().min(1).max(2000);
const Instant = z.string().datetime({ offset: true });

/** A return visit: an exact start, or a range when the date was left vague. */
export const FollowUpPayload = z
  .object({
    startsAt: Instant.optional(),
    range: z.object({ from: Instant, to: Instant }).strict().optional(),
    /** The words that were said about when, kept as said. */
    whenText: Text.optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    reason: Text.optional(),
    professional: Text.optional(),
  })
  .strict()
  .refine((value) => value.startsAt || value.range || value.whenText, {
    message: "A follow-up says when",
  });
export type FollowUpPayload = z.infer<typeof FollowUpPayload>;

export const PrescriptionItem = z
  .object({
    drug: Text,
    dose: Text.optional(),
    posology: Text.optional(),
    duration: Text.optional(),
  })
  .strict();
export type PrescriptionItem = z.infer<typeof PrescriptionItem>;

export const PrescriptionPayload = z
  .object({ items: z.array(PrescriptionItem).min(1).max(30) })
  .strict();
export type PrescriptionPayload = z.infer<typeof PrescriptionPayload>;

export const ExamRequestPayload = z
  .object({ exams: z.array(Text).min(1).max(30), indication: Text.optional() })
  .strict();
export type ExamRequestPayload = z.infer<typeof ExamRequestPayload>;

export const CertificatePayload = z
  .object({ type: Text.optional(), days: z.number().int().min(1).max(365).optional() })
  .strict();
export type CertificatePayload = z.infer<typeof CertificatePayload>;

export const PatientMessagePayload = z
  .object({ text: z.string().trim().min(1).max(4000) })
  .strict();
export type PatientMessagePayload = z.infer<typeof PatientMessagePayload>;

/** The payload of each kind; an edit is checked against the shape of the action's own kind. */
export const CONSULTATION_ACTION_PAYLOADS = {
  follow_up: FollowUpPayload,
  prescription: PrescriptionPayload,
  exam_request: ExamRequestPayload,
  certificate: CertificatePayload,
  patient_message: PatientMessagePayload,
} satisfies Record<ConsultationActionKind, z.ZodType>;

/** What the partner's agenda said about a proposed follow-up; absent when it was not asked. */
export const ConsultationActionCheck = z
  .object({
    available: z.boolean(),
    conflict: z.string().max(200).optional(),
    suggestion: Instant.optional(),
  })
  .strict();
export type ConsultationActionCheck = z.infer<typeof ConsultationActionCheck>;

export const ConsultationAction = z.object({
  id: z.string().min(1).max(32),
  kind: ConsultationActionKind,
  title: z.string(),
  detail: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: ConsultationActionStatus,
  /** Zero-based positions in `transcript` of the turns that show it was agreed. */
  evidence: z.array(z.number().int().min(0)),
  check: ConsultationActionCheck.optional(),
  /** A short code when applying failed or was skipped; never the connector's own text. */
  error: z.string().max(64).optional(),
});
export type ConsultationAction = z.infer<typeof ConsultationAction>;

export const ConsultationActionsApplyInput = z
  .object({
    actionIds: z.array(z.string().min(1).max(32)).min(1).max(CONSULTATION_ACTIONS_MAX),
    /** A replacement payload per action id, as the professional corrected it. */
    edits: z.record(z.string().min(1).max(32), z.record(z.string(), z.unknown())).optional(),
  })
  .strict();
export type ConsultationActionsApplyInput = z.infer<typeof ConsultationActionsApplyInput>;

export const ConsultationActionsApplyResult = z.object({ actions: z.array(ConsultationAction) });
export type ConsultationActionsApplyResult = z.infer<typeof ConsultationActionsApplyResult>;

/**
 * The connector tools that carry out and check actions. Each is looked up by name in the tools the
 * customer's connector offers; a name the template sets wins over the lookup by name pattern.
 */
export const ConsultationActionTools = z
  .object({
    availability: z.string().min(1).max(128).optional(),
    conflicts: z.string().min(1).max(128).optional(),
    follow_up: z.string().min(1).max(128).optional(),
    prescription: z.string().min(1).max(128).optional(),
    exam_request: z.string().min(1).max(128).optional(),
    certificate: z.string().min(1).max(128).optional(),
    patient_message: z.string().min(1).max(128).optional(),
  })
  .strict();
export type ConsultationActionTools = z.infer<typeof ConsultationActionTools>;
