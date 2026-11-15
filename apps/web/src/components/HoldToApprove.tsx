import { HOLD_TO_APPROVE_MS } from "@corvo/core";
import { Button, cn } from "@corvo/ui-web";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Whether the person asked the system to cut back motion; a hold needs a fill to be seen. */
export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia?.(query).matches === true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** A hold that completes after `duration`, and lets go the moment it is released or cancelled. */
export function useHold(onComplete: () => void, duration = HOLD_TO_APPROVE_MS) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }, []);
  const start = useCallback(() => {
    if (timer.current !== undefined) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      complete.current();
    }, duration);
  }, [duration]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { holding, start, cancel };
}

/**
 * Approves an action only once the button has been held: the fill runs across while it is held and
 * lets go if the press ends early. Enter or Space held does the same. A click that came from neither
 * pointer nor keyboard (a screen reader activating the control) approves at once, since that is
 * already a deliberate act. With reduced motion there is no fill to wait for, so it is a plain
 * button with `confirmLabel`.
 */
export function HoldToApprove({
  label,
  confirmLabel,
  onApprove,
  disabled,
  busy,
  className,
}: {
  /** The words on the held button. */
  label: string;
  /** The words on the plain button used with reduced motion. */
  confirmLabel: string;
  onApprove: () => void;
  disabled?: boolean;
  /** Set while the answer is being sent: the words shown on the plain, disabled button. */
  busy?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const { holding, start, cancel } = useHold(onApprove);

  if (reduced || busy) {
    return (
      <Button
        variant="brand"
        className={className}
        disabled={disabled || Boolean(busy)}
        onClick={() => onApprove()}
      >
        {busy ?? confirmLabel}
      </Button>
    );
  }

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0 && !disabled) start();
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // The browser would click on this key; the hold stands in for the click.
    event.preventDefault();
    if (!event.repeat && !disabled) start();
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Space clicks on release unless told not to.
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
    cancel();
  };
  const click = (event: MouseEvent<HTMLButtonElement>) => {
    // A press has a pointer position; a click without one is assistive technology.
    if (event.detail === 0 && !disabled) onApprove();
  };

  return (
    <Button
      variant="secondary"
      data-holding={holding || undefined}
      className={cn("relative overflow-hidden", className)}
      disabled={disabled}
      onPointerDown={press}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={key}
      onKeyUp={keyUp}
      onBlur={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onClick={click}
    >
      <span
        aria-hidden="true"
        data-testid="hold-fill"
        className="absolute inset-0 flex items-center justify-center bg-brand px-5 text-brand-foreground ease-linear"
        style={{
          clipPath: `inset(0 ${holding ? 0 : 100}% 0 0)`,
          transition: holding
            ? `clip-path ${HOLD_TO_APPROVE_MS}ms linear`
            : "clip-path 150ms ease-out",
        }}
      >
        {label}
      </span>
      <span>{label}</span>
    </Button>
  );
}
