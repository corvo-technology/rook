import { toast } from "./components/ui/sonner.js";

const UNDO_DURATION_MS = 8000;

export type UndoableOptions<T> = {
  /** What happened, past tense ("Rule removed"). */
  message: string;
  /** The toast action ("Undo"). */
  undoLabel: string;
  /** Performs the change now. Its result is returned. */
  run: () => Promise<T> | T;
  /** Reverses it. */
  undo: (result: T) => Promise<unknown> | unknown;
  /** Shown after a successful undo ("Undone"). */
  undoneMessage?: string;
  /** Shown when the undo itself fails. */
  undoFailedMessage?: string;
  durationMs?: number;
};

/**
 * Perform a reversible action immediately and offer Undo in the app's toast (sonner, via
 * `Toaster`). If `run` throws, nothing is shown and the error propagates, so the caller reports it
 * inline. The backend must keep whatever `undo` needs; when it cannot, use `undoableDeferred`.
 */
export async function undoable<T>(options: UndoableOptions<T>): Promise<T> {
  const result = await options.run();
  toast(options.message, {
    duration: options.durationMs ?? UNDO_DURATION_MS,
    action: {
      label: options.undoLabel,
      onClick: () => {
        void (async () => {
          try {
            await options.undo(result);
            if (options.undoneMessage) toast(options.undoneMessage);
          } catch {
            if (options.undoFailedMessage) toast.error(options.undoFailedMessage);
          }
        })();
      },
    },
  });
  return result;
}

export type UndoableDeferredOptions = {
  message: string;
  undoLabel: string;
  /** Runs once the toast has expired without Undo. The caller hides the item meanwhile. */
  commit: () => Promise<unknown> | unknown;
  /** Called if Undo is pressed, so the caller shows the item again. */
  onUndo?: () => void;
  durationMs?: number;
};

/**
 * For actions with no real undo: the caller hides the item at once and the commit waits for the
 * toast to expire. Resolves `"undone"` or `"committed"`. Leaving the page before it expires drops
 * the commit, so only use this where that is acceptable.
 */
export function undoableDeferred(
  options: UndoableDeferredOptions,
): Promise<"undone" | "committed"> {
  const duration = options.durationMs ?? UNDO_DURATION_MS;
  return new Promise((resolve, reject) => {
    let undone = false;
    const timer = setTimeout(() => {
      if (undone) return;
      Promise.resolve(options.commit()).then(() => resolve("committed"), reject);
    }, duration);
    toast(options.message, {
      duration,
      action: {
        label: options.undoLabel,
        onClick: () => {
          undone = true;
          clearTimeout(timer);
          options.onUndo?.();
          resolve("undone");
        },
      },
    });
  });
}
