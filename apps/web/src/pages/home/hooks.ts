import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../../components/HoldToApprove";
import { countUpValue } from "../../lib/home-live";

/** A clock that ticks every `ms` (a second by default), for elapsed times. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** A number that counts up to `target` on first show and eases to each new one; still when reduced. */
export function useCountUp(target: number, duration = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(() => (reduced ? target : 0));
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    const from = value;
    const start = performance.now();
    let frame = 0;
    const step = (at: number) => {
      const eased = countUpValue(target - from, at - start, duration, false);
      setValue(from + eased);
      if (at - start < duration) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `value` is where this run starts from, not something to restart on.
  }, [target, duration, reduced]);
  return value;
}

/** Text typed in a character at a time whenever it changes; at once when reduced. */
export function useTypewriter(text: string, perChar = 14): string {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduced ? text.length : 0);
  useEffect(() => {
    if (reduced) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const timer = setInterval(() => {
      setShown((count) => {
        if (count >= text.length) {
          clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, perChar);
    return () => clearInterval(timer);
  }, [text, perChar, reduced]);
  return text.slice(0, shown);
}
