import type { OnboardingPicks } from "@corvo/contracts";
import { OnboardingPicksSchema } from "@corvo/contracts";
import type { OnboardingStepId } from "./onboarding-steps";

const KEY = "corvo:onboarding-progress";
const PICKS_KEY = "corvo:onboarding-picks";
const STEPS: readonly string[] = ["workspace", "survey", "model", "bot", "computer"];

function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** The steps this account finished in this tab, so a reload or a billing return resumes after them. */
export function loadDoneSteps(
  userId: string,
  storage: Storage | null = sessionStorageOrNull(),
): Set<OnboardingStepId> {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? "null") as {
      userId?: unknown;
      done?: unknown;
    } | null;
    if (saved?.userId !== userId || !Array.isArray(saved.done)) return new Set();
    return new Set(
      saved.done.filter((step): step is OnboardingStepId => STEPS.includes(step as string)),
    );
  } catch {
    return new Set();
  }
}

export function saveDoneSteps(
  userId: string,
  done: ReadonlySet<OnboardingStepId>,
  storage: Storage | null = sessionStorageOrNull(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ userId, done: [...done] }));
  } catch {
    // Progress is a convenience; without storage the flow just starts from the top.
  }
}

/** What the person picked on the survey step, kept for the step that makes their first agent. */
export function savePicks(
  userId: string,
  picks: OnboardingPicks,
  storage: Storage | null = sessionStorageOrNull(),
): void {
  try {
    storage?.setItem(PICKS_KEY, JSON.stringify({ userId, picks }));
  } catch {
    // Without storage the flow just ends in the Chief's chat.
  }
}

export function loadPicks(
  userId: string,
  storage: Storage | null = sessionStorageOrNull(),
): OnboardingPicks | null {
  try {
    const saved = JSON.parse(storage?.getItem(PICKS_KEY) ?? "null") as {
      userId?: unknown;
      picks?: unknown;
    } | null;
    if (saved?.userId !== userId) return null;
    const parsed = OnboardingPicksSchema.safeParse(saved.picks);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
