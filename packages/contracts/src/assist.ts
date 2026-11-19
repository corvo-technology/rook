import { z } from "zod";

/** Bounds on what a partner's page may hand the assistant. Partner text is untrusted input. */
export const ASSIST_TASK_MAX_CHARS = 2000;
export const ASSIST_INSTRUCTIONS_MAX_CHARS = 4000;
export const ASSIST_CONTEXT_MAX_BYTES = 64 * 1024;
export const ASSIST_SCHEMA_MAX_BYTES = 16 * 1024;
export const ASSIST_MAX_PRESETS = 20;

const Name = z
  .string()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const byteLength = (value: unknown): number => {
  try {
    return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** Whether a JSON Schema reaches outside itself; only `#...` references are followed. */
function hasRemoteReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasRemoteReference);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) =>
    key === "$ref" || key === "$dynamicRef"
      ? typeof child !== "string" || !child.startsWith("#")
      : hasRemoteReference(child),
  );
}

/** The shape a result must take: a bounded JSON Schema whose root is an object. */
export const AssistSchema = z
  .record(z.string(), z.unknown())
  .refine((schema) => schema.type === "object", { message: "The schema's root must be an object" })
  .refine((schema) => byteLength(schema) <= ASSIST_SCHEMA_MAX_BYTES, {
    message: "The schema is too large",
  })
  .refine((schema) => !hasRemoteReference(schema), { message: "Remote references are refused" });
export type AssistSchema = z.infer<typeof AssistSchema>;

/** A task a partner defined once, in its template, and then names from its pages. */
export const AssistPreset = z
  .object({
    description: z.string().trim().max(200).optional(),
    task: z.string().trim().min(1).max(ASSIST_TASK_MAX_CHARS),
    instructions: z.string().trim().max(ASSIST_INSTRUCTIONS_MAX_CHARS).optional(),
    schema: AssistSchema.optional(),
  })
  .strict();
export type AssistPreset = z.infer<typeof AssistPreset>;

export const AssistPresets = z
  .record(Name, AssistPreset)
  .refine((presets) => Object.keys(presets).length <= ASSIST_MAX_PRESETS, {
    message: "Too many presets",
  });
export type AssistPresets = z.infer<typeof AssistPresets>;

const Context = z.unknown().refine((value) => byteLength(value) <= ASSIST_CONTEXT_MAX_BYTES, {
  message: "The context is too large",
});

/** One headless request: a task, the page's own data, and the shape of the answer. */
export const AssistAskInput = z
  .object({
    /** A task from the partner's template; the fields below override what it sets. */
    preset: Name.optional(),
    task: z.string().trim().min(1).max(ASSIST_TASK_MAX_CHARS).optional(),
    instructions: z.string().trim().max(ASSIST_INSTRUCTIONS_MAX_CHARS).optional(),
    /** Anything the page knows that the task needs. Treated as data, never as instructions. */
    context: Context.optional(),
    /** Without a schema the answer is text, in `{ text }`. */
    schema: AssistSchema.optional(),
    /** Answer as a stream of server-sent events instead of one JSON body. */
    stream: z.boolean().optional(),
  })
  .strict()
  .refine((input) => Boolean(input.preset ?? input.task), {
    message: "Name a preset or give a task",
  });
export type AssistAskInput = z.infer<typeof AssistAskInput>;

export const ASSIST_ERROR_CODES = [
  "unknown_preset",
  "invalid_schema",
  "invalid_output",
  "allowance_exhausted",
  "model_failed",
  "no_model",
] as const;
export type AssistErrorCode = (typeof ASSIST_ERROR_CODES)[number];

export const AssistAskResult = z.object({ result: z.record(z.string(), z.unknown()) });
export type AssistAskResult = z.infer<typeof AssistAskResult>;

/** What a recording must produce: the same task shape as {@link AssistAskInput}, without context. */
export const ConsultationOutput = z
  .object({
    preset: Name.optional(),
    task: z.string().trim().min(1).max(ASSIST_TASK_MAX_CHARS).optional(),
    instructions: z.string().trim().max(ASSIST_INSTRUCTIONS_MAX_CHARS).optional(),
    schema: AssistSchema.optional(),
  })
  .strict()
  .refine((output) => Boolean(output.preset ?? output.task ?? output.schema), {
    message: "Name a preset, a task or a schema",
  });
export type ConsultationOutput = z.infer<typeof ConsultationOutput>;
