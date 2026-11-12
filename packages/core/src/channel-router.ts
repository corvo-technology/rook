/**
 * Who answers a message that names nobody in a channel. The model only scores the members the
 * code offers; this module turns the scores into a pick and owns every threshold.
 */

/** A member scores at or above this to be picked, and the message needs an agent at or above it. */
export const ROUTER_THRESHOLD = 0.5;
/** Most members a message for everyone wakes. */
export const ROUTER_MAX_PICKS = 3;
/** A short follow-up this soon after an agent answered goes back to that agent. */
export const ROUTER_CONTINUITY_MS = 5 * 60_000;
export const ROUTER_CONTINUITY_MAX_CHARS = 140;

export type RouterScores = {
  /** Candidate bot id to 0..1. */
  scores: Record<string, number>;
  forEveryone: number;
  needsAgent: number;
  reason: string;
};

export type RouterDecision = {
  /** `model` and `continuity` pick by judgement; `fallback` is the pre-router rule. */
  strategy: "model" | "continuity" | "fallback";
  picked: string[];
  scores?: RouterScores;
  error?: string;
};

function unit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : undefined;
}

/** Reads the model's JSON; anything incomplete is a failure, never a guess. */
export function parseRouterScores(
  raw: string | undefined,
  candidateIds: readonly string[],
): RouterScores | undefined {
  const start = raw?.indexOf("{") ?? -1;
  const end = raw?.lastIndexOf("}") ?? -1;
  if (!raw || start < 0 || end < start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const { scores, forEveryone, needsAgent, reason } = parsed as Record<string, unknown>;
  const everyone = unit(forEveryone);
  const needs = unit(needsAgent);
  if (everyone === undefined || needs === undefined) return undefined;
  if (!scores || typeof scores !== "object") return undefined;
  const allowed = new Set(candidateIds);
  const kept: Record<string, number> = {};
  for (const [id, value] of Object.entries(scores)) {
    const score = unit(value);
    if (allowed.has(id) && score !== undefined) kept[id] = score;
  }
  return {
    scores: kept,
    forEveryone: everyone,
    needsAgent: needs,
    reason: typeof reason === "string" ? reason.slice(0, 240) : "",
  };
}

/**
 * Nobody when no agent is needed; otherwise the best candidate, or up to three when the message
 * is for everyone. Ids the code did not offer can never be picked.
 */
export function pickRoutedBots(scores: RouterScores, candidateIds: readonly string[]): string[] {
  if (scores.needsAgent < ROUTER_THRESHOLD) return [];
  const ranked = candidateIds
    .map((id) => ({ id, score: scores.scores[id] ?? 0 }))
    .filter((entry) => entry.score >= ROUTER_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  const limit = scores.forEveryone >= ROUTER_THRESHOLD ? ROUTER_MAX_PICKS : 1;
  return ranked.slice(0, limit).map((entry) => entry.id);
}

/**
 * The agent that just answered the person, when a short follow-up arrives right after: that is
 * a reply to it, not a new question for the room.
 */
export function continuityBotId(input: {
  text: string;
  now: number;
  /** The newest message of the channel before this one. */
  last: { role: string; botId?: string | null; createdAt: Date } | undefined;
  candidateIds: readonly string[];
}): string | undefined {
  const { last } = input;
  if (last?.role !== "bot" || !last.botId) return undefined;
  if (!input.candidateIds.includes(last.botId)) return undefined;
  if (input.now - last.createdAt.getTime() > ROUTER_CONTINUITY_MS) return undefined;
  const text = input.text.trim();
  return text.length > 0 && text.length <= ROUTER_CONTINUITY_MAX_CHARS ? last.botId : undefined;
}

/**
 * Whether the router, not a mention, a one-to-one chat or an answer, woke this bot for the
 * message: only then may it pass. Reads what `RouterDecision` stored on the message.
 */
export function isRouterWake(routing: unknown, botId: string): boolean {
  if (!routing || typeof routing !== "object") return false;
  const { strategy, picked } = routing as { strategy?: unknown; picked?: unknown };
  return strategy === "model" && Array.isArray(picked) && picked.includes(botId);
}
