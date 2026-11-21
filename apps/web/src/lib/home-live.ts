import type { PendingApproval, RoutineOccurrence, RunActivityRow } from "@corvo/contracts";
import { PLACEHOLDER_ACCOUNT_NAMES } from "@corvo/core";
import { HOME_CARD_LIMIT } from "./home-cards";

const firstWord = (name: string | null | undefined): string => name?.trim().split(/\s+/)[0] ?? "";

function usable(name: string | null | undefined): string {
  const word = firstWord(name);
  return PLACEHOLDER_ACCOUNT_NAMES.has(word.toLowerCase()) ? "" : word;
}

/**
 * The word the greeting uses: the member's display name, else the account's name, else the start
 * of the email. Never a placeholder such as "Account".
 */
export function greetingName(who: {
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
}): string {
  const chosen = usable(who.displayName) || usable(who.name);
  if (chosen) return chosen;
  const local = (who.email?.split("@")[0] ?? "").split(/[._+\-\d]+/)[0] ?? "";
  if (!local || PLACEHOLDER_ACCOUNT_NAMES.has(local.toLowerCase())) return "";
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export type HomeStatus = {
  working: number;
  waiting: number;
  /** Whole minutes to the next routine (at least 1), or null when none is due soon. */
  nextInMinutes: number | null;
};

/** The numbers on the hero's live line. */
export function statusCounts(input: {
  workingTotal: number;
  waitingTotal: number;
  upcoming: readonly RoutineOccurrence[];
  now: Date;
}): HomeStatus {
  const next = input.upcoming
    .filter((entry) => entry.state === "upcoming")
    .map((entry) => Date.parse(entry.at) - input.now.getTime())
    .filter((delta) => delta >= 0)
    .sort((a, b) => a - b)[0];
  return {
    working: input.workingTotal,
    waiting: input.waitingTotal,
    nextInMinutes: next === undefined ? null : Math.max(1, Math.ceil(next / 60_000)),
  };
}

export type TimelineEntry = RoutineOccurrence & { past: boolean };
export type Timeline = {
  today: TimelineEntry[];
  tomorrow: TimelineEntry[];
  /** Index in `today` the "now" line sits before (the first entry still ahead); `today.length` if none. */
  nowIndex: number;
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** Routines for today and tomorrow in time order, with where the "now" line falls. */
export function timelineGroups(occurrences: readonly RoutineOccurrence[], now: Date): Timeline {
  const today0 = startOfDay(now).getTime();
  const tomorrow0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const after0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  const sorted = [...occurrences].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const entry = (item: RoutineOccurrence): TimelineEntry => ({
    ...item,
    past: item.state !== "upcoming" && item.state !== "running",
  });
  const today = sorted
    .filter((item) => Date.parse(item.at) >= today0 && Date.parse(item.at) < tomorrow0)
    .map(entry);
  const tomorrow = sorted
    .filter((item) => Date.parse(item.at) >= tomorrow0 && Date.parse(item.at) < after0)
    .map(entry);
  const ahead = today.findIndex((item) => !item.past && Date.parse(item.at) >= now.getTime());
  return { today, tomorrow, nowIndex: ahead === -1 ? today.length : ahead };
}

/** Longest a day lists before the rest is left for the routines page. */
export const TIMELINE_DAY_LIMIT = HOME_CARD_LIMIT + 2;

/** What a working row says it is doing: the agent's latest message, else what it was asked. */
export function stepText(run: RunActivityRow): string {
  const message = run.agentMessage;
  if (message && message.kind !== "unknown" && message.text) return message.text;
  return run.promptSnippet;
}

export function runStart(run: RunActivityRow): number {
  return Date.parse(run.startedAt ?? run.updatedAt);
}

/** `m:ss` or `h:mm:ss` for a tick of elapsed time. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The next value of a count-up at `elapsed` of `duration` ms, easing out; the target when reduced. */
export function countUpValue(
  target: number,
  elapsed: number,
  duration: number,
  reduced: boolean,
): number {
  if (reduced || duration <= 0 || elapsed >= duration) return target;
  const t = Math.max(0, elapsed / duration);
  return Math.round(target * (1 - (1 - t) ** 3));
}

export const waitingKey = (item: PendingApproval): string =>
  `${item.messageId}:${item.block.kind === "ask" ? item.block.approvalEffectId : ""}`;
