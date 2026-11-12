import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearComposerTyping, noteComposerTyping, TYPING_HOLD_MS } from "./composer-typing";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  clearComposerTyping();
  vi.useRealTimers();
});

it("keeps counting as typing between keystrokes and stops a moment after the last", () => {
  const seen: boolean[] = [];
  // The hook reads this snapshot through the same store, so observe it by the timer's effect.
  noteComposerTyping();
  vi.advanceTimersByTime(TYPING_HOLD_MS - 100);
  noteComposerTyping();
  vi.advanceTimersByTime(TYPING_HOLD_MS - 100);
  seen.push(vi.getTimerCount() > 0);
  vi.advanceTimersByTime(200);
  seen.push(vi.getTimerCount() > 0);
  expect(seen).toEqual([true, false]);
});
