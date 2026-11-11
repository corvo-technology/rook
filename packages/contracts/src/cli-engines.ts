import * as z from "zod";

/** The model provider id of models that run on a coding-agent CLI installed where the engine runs. */
export const CLI_ENGINE_PROVIDER_ID = "cli-engine";

export const CliEngineIdSchema = z.enum(["claude"]);
export type CliEngineId = z.infer<typeof CliEngineIdSchema>;

/** Where an engine stands: no binary, too old, not signed in to a plan, signed in with a key, or usable. */
export const CliEngineStateSchema = z.enum([
  "missing",
  "unsupported",
  "signed_out",
  "api_key",
  "ready",
]);
export type CliEngineState = z.infer<typeof CliEngineStateSchema>;

/** `models` holds full model ids and is empty unless the engine is ready. It never carries a path or an account. */
export const CliEngineStatusSchema = z.object({
  id: CliEngineIdSchema,
  state: CliEngineStateSchema,
  version: z.string().nullable(),
  models: z.array(z.string()),
  checkedAt: z.string(),
});
export type CliEngineStatus = z.infer<typeof CliEngineStatusSchema>;

export const CliEnginesViewSchema = z.object({
  enabled: z.boolean(),
  engines: z.array(CliEngineStatusSchema),
});
export type CliEnginesView = z.infer<typeof CliEnginesViewSchema>;

export function cliEngineModelId(engine: CliEngineId, model: string): string {
  return `${engine}/${model}`;
}

export function parseCliEngineModelId(
  id: string,
): { engine: CliEngineId; model: string } | undefined {
  const parts = id.split("/");
  if (parts.length !== 2 || !parts[1]) return undefined;
  const engine = CliEngineIdSchema.safeParse(parts[0]);
  return engine.success ? { engine: engine.data, model: parts[1] } : undefined;
}

/** What the page may offer for one engine on this machine. Nothing here names a path or account. */
export const CliEngineSetupSchema = z.object({
  id: CliEngineIdSchema,
  installable: z.boolean(),
  /** How the engine signs in here: its own browser flow, a relayed terminal, or not at all. */
  signIn: z.enum(["browser", "terminal"]).nullable(),
});
export type CliEngineSetup = z.infer<typeof CliEngineSetupSchema>;

export const CliEngineInstallResultSchema = z.object({
  state: z.enum(["installed", "mismatch", "failed"]),
});
export type CliEngineInstallResult = z.infer<typeof CliEngineInstallResultSchema>;

export const CliLoginStartSchema = z.object({
  sessionId: z.string(),
  mode: z.enum(["browser", "terminal"]),
});

/** One sign-in session: a page address for the browser flow, text lines for the terminal one. */
export const CliLoginSessionSchema = z.object({
  state: z.enum(["running", "done", "failed", "cancelled"]),
  lines: z.array(z.string()),
  url: z.string().optional(),
  error: z.string().optional(),
});
export type CliLoginSession = z.infer<typeof CliLoginSessionSchema>;

export const CLI_LOGIN_KEYS = ["enter", "up", "down", "esc", "tab", "backspace"] as const;

export const CliLoginInputSchema = z.object({
  sessionId: z.string().max(100),
  text: z.string().max(2000).optional(),
  key: z.enum(CLI_LOGIN_KEYS).optional(),
});
