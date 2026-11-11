import * as z from "zod";

export const LocalModelOptionSchema = z.object({
  id: z.string().max(200),
  kind: z.enum(["server", "local", "connection"]),
  label: z.string(),
  provider: z.string(),
  credentialId: z.string().optional(),
  models: z.array(z.string()).max(500),
  modelId: z.string(),
  backgroundModelId: z.string().nullable(),
  testable: z.boolean(),
});
export type LocalModelOption = z.infer<typeof LocalModelOptionSchema>;

export const LocalSetupReportSchema = z.object({
  enabled: z.boolean(),
  checking: z.boolean(),
  checkedAt: z.number().nullable(),
  options: z.array(LocalModelOptionSchema),
});
export type LocalSetupReport = z.infer<typeof LocalSetupReportSchema>;

export const LocalModelTestSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), ms: z.number() }),
  z.object({ ok: z.literal(false), ms: z.number(), error: z.string() }),
]);
export type LocalModelTest = z.infer<typeof LocalModelTestSchema>;

export const LocalOptionChoiceSchema = z.object({
  optionId: z.string().max(200),
  modelId: z.string().max(300),
});
export type LocalOptionChoice = z.infer<typeof LocalOptionChoiceSchema>;

export const DISABLED_LOCAL_SETUP: LocalSetupReport = {
  enabled: false,
  checking: false,
  checkedAt: null,
  options: [],
};
