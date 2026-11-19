import * as z from "zod";

/**
 * What the partner's page tells an embedded assistant: where the person is, and the few actions
 * the page can carry out for them. All of it is partner-controlled text: it is limited here,
 * fenced when the agent reads it, and never treated as instructions.
 */
export const HOST_PAGE_MAX_LENGTH = 200;
export const HOST_LABEL_MAX_LENGTH = 120;
export const HOST_ENTITY_MAX = 5;
export const HOST_ACTION_MAX = 12;
export const HOST_PARAM_MAX = 12;
export const HOST_RESULT_MAX_LENGTH = 300;
export const HOST_PARAM_VALUE_MAX_LENGTH = 500;

const hostText = (max: number) => z.string().max(max);

export const HostEntitySchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/i),
  id: hostText(64).min(1),
  label: hostText(HOST_LABEL_MAX_LENGTH).min(1),
});
export type HostEntity = z.infer<typeof HostEntitySchema>;

export const HostContextSchema = z.object({
  page: hostText(HOST_PAGE_MAX_LENGTH).optional(),
  title: hostText(HOST_LABEL_MAX_LENGTH).optional(),
  entities: z.array(HostEntitySchema).max(HOST_ENTITY_MAX).default([]),
});
export type HostContext = z.infer<typeof HostContextSchema>;

const HostParamSchema = z.object({
  type: z.enum(["string", "number", "integer", "boolean"]),
  description: hostText(HOST_LABEL_MAX_LENGTH).optional(),
  enum: z
    .array(z.union([z.string().max(80), z.number()]))
    .max(20)
    .optional(),
  maxLength: z.number().int().min(1).max(HOST_PARAM_VALUE_MAX_LENGTH).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});
export type HostParam = z.infer<typeof HostParamSchema>;

/** The small slice of JSON Schema an action's params may use: one flat object of scalars. */
export const HostParamsSchema = z.object({
  type: z.literal("object").default("object"),
  properties: z
    .record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/), HostParamSchema)
    .default({}),
  required: z.array(z.string()).max(HOST_PARAM_MAX).default([]),
});
export type HostParams = z.infer<typeof HostParamsSchema>;

export const HostActionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_.-]{0,39}$/),
  description: hostText(200).default(""),
  params: HostParamsSchema.default({ type: "object", properties: {}, required: [] }),
  /** Accepted for clarity; every action asks the person first, whatever this says. */
  confirm: z.boolean().optional(),
});
export type HostAction = z.infer<typeof HostActionSchema>;

export const HostActionOutcomeSchema = z.enum(["done", "denied", "failed"]);
export type HostActionOutcome = z.infer<typeof HostActionOutcomeSchema>;

export const HostActionResultSchema = z.object({
  name: HostActionSchema.shape.name,
  outcome: HostActionOutcomeSchema,
  result: hostText(HOST_RESULT_MAX_LENGTH).optional(),
});
export type HostActionResult = z.infer<typeof HostActionResultSchema>;

/** Sent with a message: the page state now, the actions it offers, and what the last one did. */
export const HostTurnSchema = z.object({
  context: HostContextSchema.optional(),
  actions: z.array(HostActionSchema).max(HOST_ACTION_MAX).optional(),
  results: z.array(HostActionResultSchema).max(HOST_ENTITY_MAX).optional(),
});
export type HostTurn = z.infer<typeof HostTurnSchema>;

const hostParamsError = (message: string) => ({ ok: false as const, error: message });

/**
 * Checks what the page was asked to do against the schema it registered. The same rules run in
 * the SDK, on the server, and in the page that receives the action, so a value that fails one
 * never reaches the others.
 */
export function validateHostParams(
  schema: HostParams,
  value: unknown,
): { ok: true; params: Record<string, string | number | boolean> } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return hostParamsError("params must be an object");
  }
  const input = value as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(input)) {
    if (!(key in schema.properties)) return hostParamsError(`unknown param ${key}`);
  }
  for (const key of schema.required) {
    if (input[key] === undefined) return hostParamsError(`missing param ${key}`);
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    const item = input[key];
    if (item === undefined) continue;
    if (rule.type === "string") {
      if (typeof item !== "string") return hostParamsError(`${key} must be a string`);
      if (item.length > (rule.maxLength ?? HOST_PARAM_VALUE_MAX_LENGTH)) {
        return hostParamsError(`${key} is too long`);
      }
    } else if (rule.type === "boolean") {
      if (typeof item !== "boolean") return hostParamsError(`${key} must be a boolean`);
    } else {
      if (typeof item !== "number" || !Number.isFinite(item)) {
        return hostParamsError(`${key} must be a number`);
      }
      if (rule.type === "integer" && !Number.isInteger(item)) {
        return hostParamsError(`${key} must be an integer`);
      }
      if (rule.minimum !== undefined && item < rule.minimum) {
        return hostParamsError(`${key} is too small`);
      }
      if (rule.maximum !== undefined && item > rule.maximum) {
        return hostParamsError(`${key} is too large`);
      }
    }
    if (rule.enum && !rule.enum.includes(item as string | number)) {
      return hostParamsError(`${key} is not an allowed value`);
    }
    out[key] = item as string | number | boolean;
  }
  return { ok: true, params: out };
}
