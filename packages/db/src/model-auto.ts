/**
 * Whether a new agent picks its model each turn. Only where the deployment set up a fast or
 * strong tier, and only when no model was chosen for it; an agent made from another one follows
 * it, and an existing agent is never switched.
 */
export function newAgentModelAuto(input: {
  /** The model the new agent was given, or inherited from its parent. */
  modelId: string | null;
  requested?: boolean;
  parentAuto?: boolean;
  settings?: { fastModelId: string | null; strongModelId: string | null } | null;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (input.modelId) return false;
  if (input.requested !== undefined) return input.requested;
  if (input.parentAuto) return true;
  const env = input.env ?? process.env;
  return Boolean(
    input.settings?.fastModelId ||
      input.settings?.strongModelId ||
      env.PI_FAST_MODEL?.trim() ||
      env.PI_STRONG_MODEL?.trim(),
  );
}
