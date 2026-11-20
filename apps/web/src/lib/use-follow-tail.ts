import type { RefObject, UIEvent } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { transcriptIsNearEnd, transcriptMovedDown } from "./transcript-scroll";

/**
 * Keeps a scrolling list at its end while the reader is there, and leaves it alone once they
 * scroll up, the way the main transcript does. `tail` changes when something new arrives and
 * `own` says the reader wrote it, which always brings them back to the end.
 */
export function useFollowTail(
  scrollRef: RefObject<HTMLElement | null>,
  tail: unknown,
  own: boolean,
) {
  const [atEnd, setAtEnd] = useState(true);
  const following = useRef(true);
  const lastScrollTop = useRef<number | null>(null);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    following.current = true;
    setAtEnd(true);
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (own) following.current = true;
    if (following.current) jumpToLatest();
  }, [tail]);

  const unfollow = (element: HTMLElement) => {
    lastScrollTop.current = element.scrollTop;
    following.current = false;
  };

  return {
    atEnd,
    jumpToLatest,
    scrollProps: {
      onTouchStart: (event: UIEvent<HTMLElement>) => unfollow(event.currentTarget),
      onWheel: (event: UIEvent<HTMLElement> & { deltaY: number }) => {
        if (event.deltaY < 0) unfollow(event.currentTarget);
      },
      onScroll: (event: UIEvent<HTMLElement>) => {
        const element = event.currentTarget;
        const scrolledDown = transcriptMovedDown(lastScrollTop.current, element.scrollTop);
        lastScrollTop.current = element.scrollTop;
        const nearEnd = transcriptIsNearEnd(element);
        setAtEnd(nearEnd);
        if (nearEnd) {
          if (scrolledDown) following.current = true;
        } else {
          following.current = false;
        }
      },
    },
  };
}
