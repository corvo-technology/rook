import { ModelOutputError } from "@corvo/adapter-kit";
import type { EscalationTrigger, ModelTier, RunTrigger } from "@corvo/contracts";
import { MODEL_TIERS } from "@corvo/contracts";
import { isAutonomousRunTrigger } from "@corvo/core";
import { TurnGuardStopError } from "./run-guards.js";

/** The tier after this one, or null when it is already the strongest. */
export function nextTier(tier: ModelTier): ModelTier | null {
  return MODEL_TIERS[MODEL_TIERS.indexOf(tier) + 1] ?? null;
}

const atLeast = (tier: ModelTier, floor: ModelTier | undefined): ModelTier =>
  floor && MODEL_TIERS.indexOf(floor) > MODEL_TIERS.indexOf(tier) ? floor : tier;

/** What the router knows about a turn before any model has read it. */
export interface TurnSignals {
  /** The agent's own title and description: what kind of work it was made for. */
  title: string;
  description: string;
  trigger: RunTrigger;
  prompt: string;
  /** Rough size of the history the model would read. */
  contextTokens: number;
  attachments: number;
  /** The turn continues an action that waited for approval. */
  approvalGated: boolean;
  /** The lowest tier allowed: where an escalated run starts. */
  floor?: ModelTier;
}

export type TierReason =
  | "floor"
  | "large-context"
  | "approval"
  | "background"
  | "attachments"
  | "ambiguous";

export interface TierDecision {
  tier: ModelTier;
  /** False when the signals do not settle it, so a tiny classification call decides by meaning. */
  clear: boolean;
  reason: TierReason;
}

/**
 * How hard a tier thinks unless the member's own model choice says otherwise: a little on the cheap
 * tier, the model default (medium) on main, and a lot only where the tier is strong. It is fixed
 * for the run, because changing the effort between calls breaks the prompt cache.
 */
export const TIER_THINKING_LEVEL = {
  fast: "low",
  main: "medium",
  strong: "high",
} as const satisfies Record<ModelTier, string>;

const LARGE_CONTEXT_TOKENS = 100_000;

/**
 * Settles a turn from structure alone: where it came from, what it carries, how much history it
 * reads and whether it continues an approval. What the request means is never judged here: every
 * turn these signals leave open goes to the classifier. Pure, so each rule is easy to check.
 */
export function decideTier(signals: TurnSignals): TierDecision {
  const decide = (tier: ModelTier, clear: boolean, reason: TierReason): TierDecision => {
    const raised = atLeast(tier, signals.floor);
    return raised === tier
      ? { tier, clear, reason }
      : { tier: raised, clear: true, reason: "floor" };
  };
  // Nobody is waiting on a scheduled, watching or inbound run, and most end silent. It starts on
  // the fast tier whatever the agent's title says, and asks for more through request_stronger_model
  // or the failure escalation when the analysis needs it.
  if (isAutonomousRunTrigger(signals.trigger) && !signals.approvalGated) {
    return decide("fast", true, "background");
  }
  if (signals.contextTokens >= LARGE_CONTEXT_TOKENS) return decide("strong", true, "large-context");
  // An action that waits on approval is never the cheap tier's to carry out.
  if (signals.approvalGated) return decide("main", true, "approval");
  // Images and files are read by the tier that is known to handle them.
  if (signals.attachments > 0) return decide("main", true, "attachments");
  return decide("main", false, "ambiguous");
}

/** Bump when the classifier prompt or its reviewed examples change, so earlier reports stay comparable. */
export const TIER_RUBRIC_VERSION = "tier-classifier-v1";

/** Reviewed examples the classifier is shown. Short, in different languages, one per kind of work. */
export const TIER_RUBRIC_EXAMPLES: ReadonlyArray<{
  role: string;
  request: string;
  tier: ModelTier;
}> = [
  { role: "Inbox triage", request: "Mark these three emails urgent, normal or low.", tier: "fast" },
  { role: "Assistant", request: "Resuma essa conversa em duas frases.", tier: "fast" },
  {
    role: "Assistant",
    request: "What time is it in Tokyo when it is 9am in Lisbon?",
    tier: "fast",
  },
  {
    role: "Assistant",
    request: "Draft a polite reply declining Thursday's meeting.",
    tier: "main",
  },
  {
    role: "Sales assistant",
    request: "Find the three open deals closing this month and list their owners.",
    tier: "main",
  },
  {
    role: "Assistant",
    request: "Why does this function return NaN? Here is the code and the stack trace.",
    tier: "strong",
  },
  {
    role: "Assistant",
    request: "Plan a zero-downtime move from one database to another and name the risks.",
    tier: "strong",
  },
];

/** What the classifier is told: the rubric, its examples, one word out. */
export const TIER_CLASSIFIER_INSTRUCTIONS = [
  `Rubric ${TIER_RUBRIC_VERSION}.`,
  "Pick the cheapest model tier that can handle the request well, judging by what the request asks for, in any language. The agent's role is context only: the same role can receive easy and hard requests.",
  "fast: short routine work such as summaries, classification, short replies, simple lookups and conversions.",
  "main: ordinary tasks that use tools, writing, or some reasoning.",
  "strong: code, debugging, multi-step planning, long or high-stakes reasoning, ambiguous work where a mistake is costly.",
  "When unsure between two tiers, pick the higher one. Answer with one word: fast, main or strong.",
  "Examples:",
  ...TIER_RUBRIC_EXAMPLES.map(
    (example) => `Role: ${example.role}\nRequest: ${example.request}\nAnswer: ${example.tier}`,
  ),
].join("\n");

/** The classifier reads the agent's role and the request, not the whole conversation. */
export function tierClassifierPrompt(
  role: { title: string; description: string },
  request: string,
) {
  const roleLine = [role.title, role.description]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(": ");
  return `Role: ${roleLine.slice(0, 300) || "Assistant"}\nRequest: ${request.slice(0, TIER_CLASSIFIER_PROMPT_CHARS)}`;
}
export const TIER_CLASSIFIER_PROMPT_CHARS = 1_500;
export const TIER_CLASSIFIER_TIMEOUT_MS = 6_000;
export const TIER_CLASSIFIER_MAX_TOKENS = 8;

/** The tier a classifier answered, or null when the answer is not exactly one tier. */
export function parseTierAnswer(text: string | undefined): ModelTier | null {
  const word = text
    ?.trim()
    .toLowerCase()
    .replace(/[.!"'`]+$/g, "");
  return MODEL_TIERS.find((tier) => tier === word) ?? null;
}

/** A turn that ended in a way a stronger model can fix: unusable output, or a loop of failing calls. */
export function escalatesOnFailure(error: unknown): boolean {
  if (error instanceof ModelOutputError) return true;
  return (
    error instanceof TurnGuardStopError && (error.kind === "loop" || error.kind === "tool_errors")
  );
}

/** The agent asked for a stronger model, which ends its turn; the run then moves up a tier. */
export class StrongerModelRequested extends Error {
  override readonly name = "StrongerModelRequested";
  constructor() {
    super("The agent asked for a stronger model.");
  }
}

/** Added to the prompt of a run that may ask; the tool's own description says when. */
export const STRONGER_MODEL_INSTRUCTION =
  "You may call request_stronger_model once if the task is genuinely beyond you; most tasks are not.";

/** What made a run move up: the failure kind, or the agent asking. */
export function escalationTriggerOf(error: unknown, requested: boolean): EscalationTrigger {
  if (requested) return "agent_request";
  if (error instanceof TurnGuardStopError) return error.kind === "loop" ? "loop" : "tool_errors";
  return "model_output";
}

/** The most an agent's reason for asking is kept, so a stored line stays a line. */
export const ESCALATION_REASON_CHARS = 200;

export function clampEscalationReason(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ESCALATION_REASON_CHARS);
}

/**
 * The tier a failed run moves to, or null when it must fail as before: only an automatic run that
 * has not escalated, is not on the strongest tier, and failed in a way a stronger model can fix.
 */
export function escalationTarget(input: {
  tier: ModelTier | null;
  escalations: number;
  error: unknown;
  /** The agent asked for a stronger model itself. */
  requested?: boolean;
}): ModelTier | null {
  if (!input.tier || input.escalations > 0) return null;
  if (!input.requested && !escalatesOnFailure(input.error)) return null;
  return nextTier(input.tier);
}

/** Whether a run's tier decision applies: automatic, not pinned and not a scripted test model. */
export function routesAutomatically(input: {
  modelAuto: boolean;
  pinned: boolean;
  hasModel: boolean;
}): boolean {
  return input.modelAuto && !input.pinned && !input.hasModel;
}
