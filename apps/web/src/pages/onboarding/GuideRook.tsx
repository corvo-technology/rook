import { mascotHex } from "@corvo/core";
import { BotAvatar } from "@corvo/ui-web";
import { useLayoutEffect, useRef, useState } from "react";
import type { OnboardingStepId } from "../../lib/onboarding-steps";

const SIZE = 44;
const REACH = 240;

type Gaze = { x: number; y: number };

const calm = () =>
  typeof matchMedia !== "function" || !matchMedia("(prefers-reduced-motion: reduce)").matches;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** The control the step is about: a marked one, else its first field, else its last button. */
function controlOf(header: HTMLElement | null): HTMLElement | null {
  const card = header?.parentElement?.querySelector("main");
  if (!card) return null;
  const visible = (element: HTMLElement) => element.getClientRects().length > 0;
  const marked = card.querySelector<HTMLElement>("[data-guide-target]");
  if (marked && visible(marked)) return marked;
  const field = [
    ...card.querySelectorAll<HTMLElement>("input:not([type=hidden]), textarea, select"),
  ].find(visible);
  if (field) return field;
  const buttons = [...card.querySelectorAll<HTMLElement>("button:not([data-guide-skip])")].filter(
    visible,
  );
  return buttons.at(-1) ?? null;
}

/**
 * The rook that guides the first run. It rests above the current step and, when the flow advances,
 * travels to the next one (a short hop, a small squash on arrival), looking the way it goes and then
 * at the control the step is about. It only reads the flow's current step; the flow is untouched.
 * With reduced motion it appears in place for each step.
 */
export function GuideRook({ current }: { current: OnboardingStepId }) {
  const track = useRef<HTMLDivElement>(null);
  const mover = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const at = useRef<number | null>(null);
  const [gaze, setGaze] = useState<Gaze>({ x: 0, y: 0 });

  // Where the rook rests: above the start of the current step, kept inside the header.
  const restX = () => {
    const header = track.current?.closest("header") ?? null;
    const stop = header?.querySelector<HTMLElement>(`[data-guide-stop="${current}"]`);
    if (!track.current || !stop) return null;
    const room = track.current.getBoundingClientRect();
    const x = stop.getBoundingClientRect().left - room.left;
    return Math.max(0, Math.min(x, room.width - SIZE));
  };

  // Looks from the rook at the step's control; nothing to look at keeps the eyes straight.
  const lookAtControl = () => {
    const rook = mover.current?.getBoundingClientRect();
    const control = controlOf(track.current?.closest("header") ?? null);
    if (!rook || !control) return setGaze({ x: 0, y: 0 });
    const box = control.getBoundingClientRect();
    setGaze({
      x: clamp((box.left + box.width / 2 - (rook.left + rook.width / 2)) / REACH),
      y: clamp((box.top + box.height / 2 - (rook.top + rook.height / 2)) / REACH),
    });
  };

  useLayoutEffect(() => {
    const element = mover.current;
    const x = restX();
    if (!element || x === null) return;
    const from = at.current;
    at.current = x;
    if (from === null || from === x || !calm() || typeof element.animate !== "function") {
      element.style.transform = `translate3d(${x}px, 0, 0)`;
      lookAtControl();
      return;
    }
    const way = Math.sign(x - from);
    setGaze({ x: way, y: 0 });
    const distance = Math.abs(x - from);
    const hop = element.animate(
      [
        { transform: `translate3d(${from}px, 0, 0)` },
        { transform: `translate3d(${(from + x) / 2}px, -8px, 0)`, offset: 0.5 },
        { transform: `translate3d(${x}px, 0, 0)` },
      ],
      { duration: 360 + Math.min(distance, 320) * 0.9, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
    element.style.transform = `translate3d(${x}px, 0, 0)`;
    let cancelled = false;
    hop.finished
      .then(() => {
        if (cancelled) return;
        body.current?.animate?.(
          [
            { transform: "scale(1, 1)" },
            { transform: "scale(1.14, 0.86)", offset: 0.35 },
            { transform: "scale(0.97, 1.04)", offset: 0.7 },
            { transform: "scale(1, 1)" },
          ],
          { duration: 320, easing: "ease-out" },
        );
        lookAtControl();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      hop.cancel();
    };
  }, [current]);

  // A resize moves the stop; the rook follows it without a trip.
  useLayoutEffect(() => {
    const room = track.current;
    if (!room || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      const x = restX();
      if (x === null || !mover.current || at.current === x) return;
      at.current = x;
      mover.current.style.transform = `translate3d(${x}px, 0, 0)`;
      lookAtControl();
    });
    observer.observe(room);
    return () => observer.disconnect();
  }, [current]);

  return (
    <div ref={track} data-guide-rook={current} className="relative mb-6" style={{ height: SIZE }}>
      <div ref={mover} className="pointer-events-none absolute top-0 left-0 will-change-transform">
        <div ref={body} style={{ transformOrigin: "50% 100%" }}>
          <BotAvatar color={mascotHex("mint")} identity="corvo" size={SIZE} live lookAt={gaze} />
        </div>
      </div>
    </div>
  );
}
