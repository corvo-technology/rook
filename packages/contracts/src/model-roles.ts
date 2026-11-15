import { z } from "zod";
import type { ModelCatalogEntry } from "./domain.js";
import { ModelBackupChoiceSchema, modelChoiceListSchema, ThinkingLevelSchema } from "./domain.js";
import { Id } from "./ids.js";

/** Add purposes here; connections, persistence, pickers and backups stay shared. */
export const ModelRoleSchema = z.enum(["main", "approval", "routing", "fast", "strong"]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;
/**
 * The three tiers an automatic agent picks between, cheapest first. Each tier runs on the model
 * role of the same name, so members and spaces override a tier the way they override any role.
 */
/** Why a run moved up a tier: a turn guard or unusable output, or the agent asking for it. */
export const ESCALATION_TRIGGERS = [
  "loop",
  "tool_errors",
  "model_output",
  "agent_request",
] as const;
export type EscalationTrigger = (typeof ESCALATION_TRIGGERS)[number];

export const MODEL_TIERS = ["fast", "main", "strong"] as const satisfies readonly ModelRole[];
export const ModelTierSchema = z.enum(MODEL_TIERS);
export type ModelTier = z.infer<typeof ModelTierSchema>;
export const ModelRoleChoiceSchema = ModelBackupChoiceSchema.extend({
  thinkingLevel: ThinkingLevelSchema.nullable().optional(),
  /** The connection this row runs on; omitted rows use the provider's connection or the deployment's. */
  credentialId: Id.optional(),
});
export type ModelRoleChoice = z.infer<typeof ModelRoleChoiceSchema>;
export const ModelRoleSettingsSchema = z.object({
  primary: ModelRoleChoiceSchema.nullable(),
  backups: modelChoiceListSchema(ModelRoleChoiceSchema),
});
export type ModelRoleSettings = z.infer<typeof ModelRoleSettingsSchema>;
export const ModelRoleUpdateSchema = ModelRoleSettingsSchema.partial();
/** A member's choices plus what the deployment runs when they chose no model. */
export const ModelRoleViewSchema = ModelRoleSettingsSchema.extend({
  deploymentPrimary: ModelRoleChoiceSchema.nullable().optional(),
});
export type ModelRoleView = z.infer<typeof ModelRoleViewSchema>;

export function modelSupportsRole(entry: ModelCatalogEntry, role: ModelRole): boolean {
  // These write text: the main one for the work, the fast one for chores such as summaries and
  // the strong one for what the others cannot do.
  if (role === "main" || role === "fast" || role === "strong")
    return entry.protocol !== "decisions";
  // Routing only ever picks among a few named options, which is what decision models do.
  return role === "approval" || entry.protocol === "decisions";
}
