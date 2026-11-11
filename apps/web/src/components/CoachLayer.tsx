import type { TourMark, TourState } from "@corvo/contracts";
import type { TourFacts } from "@corvo/core";
import { dueMark, fulfilledMarks } from "@corvo/core";
import { Button, Popover, PopoverContent, PopoverDescription } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";

/** The first visible element that carries the mark's anchor attribute. */
export function findCoachAnchor(mark: TourMark, root: ParentNode = document): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(`[data-coach="${mark}"]`)) {
    if (element.getClientRects().length > 0) return element;
  }
  return null;
}

const SIDE: Record<TourMark, "top" | "right"> = {
  ask: "top",
  first: "top",
  chief: "right",
  missions: "right",
};

/**
 * Shows at most one coach mark, anchored to the real element it is about, and records the marks
 * the person has moved past. It never takes focus and ignores outside clicks and Escape.
 */
export function CoachLayer({
  tour,
  facts,
  onTourChange,
}: {
  tour: TourState | null | undefined;
  facts: TourFacts;
  onTourChange: (next: TourState) => void;
}) {
  const { t } = useLingui();
  // Marks ended in this session. A failed call is not retried, so the mark stays hidden.
  const [ended, setEnded] = useState<readonly TourMark[]>([]);
  const [skippedHere, setSkippedHere] = useState(false);
  const effective: TourState | null = tour
    ? {
        done: [...new Set([...tour.done, ...ended])],
        skipped: tour.skipped || skippedHere,
      }
    : null;

  const due = dueMark(effective, facts);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!due) {
      setAnchor(null);
      return;
    }
    const look = () => setAnchor(findCoachAnchor(due));
    look();
    const observer = new MutationObserver(look);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-coach"],
    });
    return () => observer.disconnect();
  }, [due]);

  const recorded = useRef(new Set<TourMark>());
  const latest = useRef({ effective, onTourChange });
  latest.current = { effective, onTourChange };
  const record = useCallback((mark: TourMark) => {
    const current = latest.current.effective;
    if (!current || recorded.current.has(mark)) return;
    recorded.current.add(mark);
    setEnded((previous) => [...previous, mark]);
    latest.current.onTourChange({ ...current, done: [...current.done, mark] });
    void Promise.resolve()
      .then(() => rpc.onboarding.tourDone({ mark }))
      .catch(() => undefined);
  }, []);

  const skip = () => {
    if (!effective) return;
    setSkippedHere(true);
    onTourChange({ ...effective, skipped: true });
    void Promise.resolve()
      .then(() => rpc.onboarding.tourSkip())
      .catch(() => undefined);
  };

  // The mark rendered on the previous pass: an ask is fulfilled only after it was on screen.
  const showing = useRef<TourMark | null>(null);
  const shown = due && anchor ? due : null;
  useEffect(() => {
    for (const mark of fulfilledMarks(effective, facts, showing.current)) record(mark);
    showing.current = shown;
  });

  useEffect(() => {
    if (shown !== "missions" || !anchor) return;
    const onPointerDown = () => record("missions");
    anchor.addEventListener("pointerdown", onPointerDown);
    return () => anchor.removeEventListener("pointerdown", onPointerDown);
  }, [shown, anchor, record]);

  if (!shown || !anchor) return null;
  const sentence: Record<TourMark, string> = {
    ask: t`When an agent needs you, it asks here and waits.`,
    first: t`This isn't sent yet. Edit it or send it.`,
    chief: t`Stuck? Ask the Chief.`,
    missions: t`Each one checks itself off when you do it.`,
  };
  return (
    <Popover open onOpenChange={() => undefined}>
      <PopoverContent
        anchor={anchor}
        side={SIDE[shown]}
        align="start"
        initialFocus={false}
        finalFocus={false}
        aria-live="polite"
      >
        <PopoverDescription className="text-foreground">{sentence[shown]}</PopoverDescription>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={skip}>
            {t`Skip tour`}
          </Button>
          <Button size="sm" onClick={() => record(shown)}>
            {t`Got it`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
