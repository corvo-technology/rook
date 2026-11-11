import type { ToolCallStreak } from "@corvo/core";
import { trackToolCallStreak } from "@corvo/core";

const LOOP_GUARD_STOP_PREFIX = "I got stuck calling ";
// "the same input" is the wording of rows saved before identical calls stopped being a reason.
const LOOP_GUARD_STOP_COUNT_PATTERN = " with (?:(?:nearly )?the same input|too many actions) ";
const LOOP_GUARD_STOP_SUFFIX =
  " times in a row without making progress, so I stopped early. Try rephrasing this, or ask me to try a different approach.";
const LOOP_GUARD_STOP_PATTERN = new RegExp(
  `^${LOOP_GUARD_STOP_PREFIX}.+${LOOP_GUARD_STOP_COUNT_PATTERN}\\d+${LOOP_GUARD_STOP_SUFFIX.replaceAll(".", "\\.")}$`,
);

export function loopGuardStopText(toolName: string, streak: ToolCallStreak): string {
  return `${LOOP_GUARD_STOP_PREFIX}${toolName} with nearly the same input ${toolCallStreakLength(streak)}${LOOP_GUARD_STOP_SUFFIX}`;
}

export function overLimitStopText(toolName: string, count: number): string {
  return `${LOOP_GUARD_STOP_PREFIX}${toolName} with too many actions ${count}${LOOP_GUARD_STOP_SUFFIX}`;
}

export function isLoopGuardStopText(text: string): boolean {
  return LOOP_GUARD_STOP_PATTERN.test(text);
}

// Identical calls that return the same result are stopped by the result-aware run guards. This
// streak only looks at call inputs: arguments that differ at most by digits in their text
// (`echo noop-1`, `echo noop-2`) can be a real sequence such as reading a file in chunks or
// paging through a site, so they get a lot of room.
const MAX_CONSECUTIVE_SIMILAR_TOOL_CALLS = 25;

// A batch over the action limit is refused unrun. Sending another one is a loop the model rarely
// leaves on its own, so it is told on the repeat and the run ends on this one.
export const MAX_CONSECUTIVE_OVER_LIMIT_ACTION_CALLS = 4;
/** The most actions one `computer_act` or `browser_act` call may carry. */
export const MAX_ACTIONS_PER_CALL = 24;

/** A double click expands to two computer actions; every other action stays as one. */
export function computerActionCount(action: unknown): number {
  if (!action || typeof action !== "object") return 1;
  const { kind, double } = action as { kind?: unknown; double?: unknown };
  return kind === "click" && double === true ? 2 : 1;
}

/** Counts consecutive over-limit `computer_act`/`browser_act` batches; other calls leave it alone. */
export function advanceOverLimitActionCalls(count: number, name: string, args: unknown): number {
  if (name !== "computer_act" && name !== "browser_act") return count;
  const actions = (args as { actions?: unknown } | null)?.actions;
  if (!Array.isArray(actions)) return 0;
  const actionCount =
    name === "computer_act"
      ? actions.reduce((total, action) => total + computerActionCount(action), 0)
      : actions.length;
  return actionCount > MAX_ACTIONS_PER_CALL ? count + 1 : 0;
}

/** The longer of the two runs, for the stop message. */
export function toolCallStreakLength(streak: ToolCallStreak): number {
  return Math.max(streak.count, streak.shapeCount ?? 0);
}

export function advanceToolCallLoopGuard(
  streak: ToolCallStreak,
  name: string,
  args: unknown,
): { streak: ToolCallStreak; stuck: boolean } {
  const next = trackToolCallStreak(streak, name, args);
  return {
    streak: next,
    stuck: (next.shapeCount ?? 0) >= MAX_CONSECUTIVE_SIMILAR_TOOL_CALLS,
  };
}
