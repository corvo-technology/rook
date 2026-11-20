import type { RoutingReason, RoutingReport } from "@corvo/contracts";

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
 * Nobody only when no agent is needed. Otherwise a question never goes unanswered: the candidates
 * at or above the threshold, or the single best one when none reaches it (ties keep candidate
 * order), and up to three when the message is for everyone. Ids the code did not offer can never
 * be picked.
 */
export function pickRoutedBots(scores: RouterScores, candidateIds: readonly string[]): string[] {
  if (scores.needsAgent < ROUTER_THRESHOLD) return [];
  const ranked = candidateIds
    .map((id) => ({ id, score: scores.scores[id] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const fits = ranked.filter((entry) => entry.score >= ROUTER_THRESHOLD);
  // Array.prototype.sort is stable, so ranked[0] is the first candidate among equal best scores.
  const chosen = fits.length > 0 ? fits : ranked.slice(0, 1);
  const limit = scores.forEveryone >= ROUTER_THRESHOLD ? ROUTER_MAX_PICKS : 1;
  return chosen.slice(0, limit).map((entry) => entry.id);
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

const NOTE_CHARS = 160;

/** The reasons that mean the agent was woken for the message. */
const ANSWERING: readonly RoutingReason[] = [
  "router_picked",
  "mentioned",
  "thread_owner",
  "follow_up",
  "router_failed",
];

/** Whether the agent was woken for the message (a run exists, or an earlier one took it). */
export function isAnswering(reason: RoutingReason): boolean {
  return ANSWERING.includes(reason);
}

/**
 * The record of how a channel message reached its agents: one reason per agent considered, and
 * who decided. It holds ids and codes only, plus the router's own one-line note.
 */
export function buildRoutingReport(input: {
  /** Everyone offered: the channel's members and any agent the message named from outside. */
  candidates: readonly string[];
  /** The ones the sender may talk to. */
  talkable: ReadonlySet<string>;
  /** Talkable agents that cannot take a run right now. */
  unavailable: ReadonlyMap<string, "paused" | "over_budget">;
  /** The agents the message woke. */
  woken: readonly string[];
  /** The agents the message named. */
  mentioned: readonly string[];
  /** What the router did; absent when it did not apply. */
  routing?: RouterDecision;
}): RoutingReport {
  const { routing } = input;
  const byRouter = routing?.strategy === "model";
  const agents: RoutingReport["agents"] = [];
  for (const botId of new Set(input.candidates)) {
    const mentioned = input.mentioned.includes(botId);
    const woken = input.woken.includes(botId);
    // A rule-routed message only reports the agents it concerns; the router reports everyone it offered.
    if (!byRouter && !mentioned && !woken) continue;
    let reason: RoutingReason;
    const unavailable = input.unavailable.get(botId);
    if (!input.talkable.has(botId)) reason = "not_in_audience";
    else if (unavailable) reason = unavailable;
    else if (woken) {
      reason = mentioned
        ? "mentioned"
        : routing?.strategy === "model"
          ? "router_picked"
          : routing?.strategy === "continuity"
            ? "follow_up"
            : routing?.strategy === "fallback"
              ? "router_failed"
              : "thread_owner";
    } else
      reason =
        routing?.strategy === "model" && routing.picked.length === 0 ? "none_needed" : "not_picked";
    agents.push({ botId, reason });
  }
  const note = byRouter ? routing?.scores?.reason.replace(/\s+/g, " ").trim() : undefined;
  return {
    by: byRouter ? "router" : "rules",
    ...(note ? { note: note.slice(0, NOTE_CHARS) } : {}),
    agents,
  };
}
