import { useSyncExternalStore } from "react";

/** How long after the last keystroke the person still counts as typing. */
export const TYPING_HOLD_MS = 1_500;

let typing = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (typing === next) return;
  typing = next;
  for (const listener of listeners) listener();
}

/** The composer reports a keystroke; the person counts as typing until they pause. */
export function noteComposerTyping(): void {
  clearTimeout(timer);
  timer = setTimeout(() => set(false), TYPING_HOLD_MS);
  set(true);
}

/** The composer is empty, sent or gone: nobody is typing. */
export function clearComposerTyping(): void {
  clearTimeout(timer);
  set(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the person is typing in the conversation's composer right now. */
export function useComposerTyping(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typing,
    () => false,
  );
}
