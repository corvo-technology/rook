/**
 * Whether a new agent picks a model tier for each turn. It does unless a model was chosen for it,
 * so a pinned model always wins. An agent made from another one follows it, and an existing agent
 * is never switched here.
 */
export function newAgentModelAuto(input: {
  /** The model the new agent was given, or inherited from its parent. */
  modelId: string | null;
  requested?: boolean;
  /** The parent's own setting when the new agent follows it; undefined without a parent. */
  parentAuto?: boolean;
}): boolean {
  if (input.modelId) return false;
  if (input.requested !== undefined) return input.requested;
  return input.parentAuto ?? true;
}
