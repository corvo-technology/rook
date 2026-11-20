import type { ToolRisk } from "./tool-risk.js";

/** The rubric the classifier prompt and its reviewed examples follow. Bump it when either changes. */
export const TOOL_CLASSIFIER_RUBRIC_VERSION = "tool-risk-v1";

/** A promotion below this confidence is ignored: the tool stays unknown and asks. */
export const MIN_CLASSIFICATION_CONFIDENCE = 0.8;

/** What a classifier suggests for one tool the name check could not place. */
export type ToolClassification = {
  risk: Exclude<ToolRisk, "unknown">;
  confidence: number;
};

export type ToolClassificationHints = {
  /** MCP `readOnlyHint`, or the method of an installed API. */
  readOnly?: boolean;
};

const SUGGESTED_RISKS = new Set<string>(["read", "low", "high"]);

/**
 * The risk of a tool once a classifier has weighed in. A suggestion only ever moves a tool the
 * name and hints left unknown: a locked, hinted-high, read or low tool keeps its own risk, so a
 * classifier can never lower one. Anything that is not a clear suggestion keeps "unknown", which
 * asks. A tool its server declared a write is never promoted to a read.
 */
export function applyToolClassification(
  base: ToolRisk,
  suggestion: ToolClassification | null | undefined,
  hints: ToolClassificationHints = {},
): ToolRisk {
  if (base !== "unknown" || !suggestion) return base;
  if (!SUGGESTED_RISKS.has(suggestion.risk)) return base;
  if (!Number.isFinite(suggestion.confidence)) return base;
  if (suggestion.confidence < MIN_CLASSIFICATION_CONFIDENCE) return base;
  if (suggestion.risk === "read" && hints.readOnly === false) return base;
  return suggestion.risk;
}
