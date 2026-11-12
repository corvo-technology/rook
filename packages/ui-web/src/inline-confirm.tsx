import type { ComponentProps } from "react";
import { useEffect, useState } from "react";
import { Button } from "./components/ui/button.js";

export type InlineConfirmProps = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  /** Idle content: text or an icon. */
  children: ComponentProps<typeof Button>["children"];
  /** What the button says while armed ("Confirm delete?"), already translated. */
  confirmLabel: string;
  onConfirm: () => void;
  /** How long it stays armed. Default 4000ms. */
  timeoutMs?: number;
};

/**
 * Two-step confirmation without a modal, for actions that cannot be undone. The first click turns
 * the button into `confirmLabel` (destructive); the second runs `onConfirm`. It disarms after
 * `timeoutMs`, on Esc and when focus leaves. Focus stays on the button so the keyboard flow is
 * Enter, Enter, and a screen reader announces `confirmLabel` as it appears. Prefer an Undo toast
 * (`undoable`) when the action can be reversed.
 */
export function InlineConfirm({
  children,
  confirmLabel,
  onConfirm,
  timeoutMs = 4000,
  variant,
  disabled,
  onBlur,
  ...props
}: InlineConfirmProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), timeoutMs);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setArmed(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [armed, timeoutMs]);

  return (
    <>
      <Button
        {...props}
        variant={armed ? "destructive" : variant}
        disabled={disabled}
        aria-label={armed ? confirmLabel : props["aria-label"]}
        data-armed={armed || undefined}
        onBlur={(event) => {
          setArmed(false);
          onBlur?.(event);
        }}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          onConfirm();
        }}
      >
        {armed ? confirmLabel : children}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {armed ? confirmLabel : ""}
      </span>
    </>
  );
}
