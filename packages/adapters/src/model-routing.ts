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
  | "code"
  | "heavy-agent"
  | "large-context"
  | "approval"
  | "background"
  | "light-agent"
  | "ambiguous";

export interface TierDecision {
  tier: ModelTier;
  /** False when the signals do not settle it, so a tiny classification call may. */
  clear: boolean;
  reason: TierReason;
}

// Agents made for triage, inboxes and summaries do small, routine work. The match is only a lean:
// anything it does not settle goes to the classifier, and any code in the turn overrides it.
const LIGHT_AGENT =
  /\b(e-?mail|inbox|triage|support|summar\w*|classif\w*|newsletter|digest|resumo|triagem|suporte|caixa de entrada|correo|bandeja|trier|boîte|posteingang)\b/i;
const HEAVY_AGENT =
  /\b(code|coder|coding|developer|engineer|programm\w*|devops|research\w*|analyst|browser|computer|automation|desenvolv\w*|engenheir\w*|pesquis\w*|programador|investigaci\w*|ingenier\w*|entwickler)\b/i;
const CODE_IN_TURN =
  /```|\b[\w./-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|rb|php|sql|sh|ya?ml|json|toml|c|cpp|cs|swift|kt)\b/;

const LIGHT_PROMPT_CHARS = 2_000;
const LIGHT_CONTEXT_TOKENS = 30_000;
const LARGE_CONTEXT_TOKENS = 100_000;

/**
 * Picks a tier from cheap signals alone. It never reads the agent's tools: every agent has a
 * computer, so the tools say nothing about the turn. Pure, so each rule is easy to check.
 */
export function decideTier(signals: TurnSignals): TierDecision {
  const profile = `${signals.title}\n${signals.description}`;
  const heavy = HEAVY_AGENT.test(profile);
  const light = LIGHT_AGENT.test(profile) && !heavy;
  const code = CODE_IN_TURN.test(signals.prompt);
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
  if (code) return decide("strong", true, "code");
  if (heavy) return decide("strong", true, "heavy-agent");
  if (signals.contextTokens >= LARGE_CONTEXT_TOKENS) return decide("strong", true, "large-context");
  // An action that waits on approval is never the cheap tier's to carry out.
  if (signals.approvalGated) return decide("main", true, "approval");
  const small =
    signals.prompt.length <= LIGHT_PROMPT_CHARS &&
    signals.contextTokens <= LIGHT_CONTEXT_TOKENS &&
    signals.attachments === 0;
  if (light && small) return decide("fast", true, "light-agent");
  return decide("main", false, "ambiguous");
}

/** What the classifier is told. A fixed instruction keeps the tiny call cheap and cacheable. */
export const TIER_CLASSIFIER_INSTRUCTIONS =
  "Pick the cheapest model tier that can handle the request well. Answer with one word: " +
  "fast for short, routine work such as summaries, classification, short replies and lookups; " +
  "main for ordinary tasks that use tools or need some reasoning; " +
  "strong for code, multi-step plans, ambiguous or high-stakes work. Answer fast, main or strong.";
/** The classifier reads the request, not the whole conversation. */
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
