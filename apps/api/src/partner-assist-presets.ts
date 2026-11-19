import type { ConsultationOutput } from "@corvo/contracts";
import { AssistPresets } from "@corvo/contracts";

/**
 * The task a request names, with what the partner's template sets for a preset and what the
 * request itself sets on top. Null when the preset is not one of the partner's.
 */
export function resolveAssistPreset(
  template: unknown,
  request: ConsultationOutput,
): ConsultationOutput | null {
  if (!request.preset) return request;
  const presets = AssistPresets.safeParse((template as { assist?: unknown } | null)?.assist).data;
  const preset = presets?.[request.preset];
  if (!preset) return null;
  const { preset: _name, ...own } = request;
  return {
    task: preset.task,
    ...(preset.instructions ? { instructions: preset.instructions } : {}),
    ...(preset.schema ? { schema: preset.schema } : {}),
    ...own,
  };
}
