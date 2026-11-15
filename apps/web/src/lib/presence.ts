import type { PresenceStatus } from "@corvo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useSpaceQueries } from "./query";
import { rpc } from "./rpc";
import { useSpaceHint } from "./space-hints";

export const PRESENCE_TOUCH_INTERVAL_MS = 60_000;

/**
 * Tells the server this client is in use at most once per interval, and at once when it goes to
 * the background. `now` is injectable for tests.
 */
export function createPresenceToucher(
  send: (active: boolean) => void,
  now: () => number = Date.now,
) {
  let lastSent = Number.NEGATIVE_INFINITY;
  let lastActive: boolean | null = null;
  return {
    active() {
      const at = now();
      if (lastActive === true && at - lastSent < PRESENCE_TOUCH_INTERVAL_MS) return;
      lastSent = at;
      lastActive = true;
      send(true);
    },
    inactive() {
      if (lastActive === false) return;
      lastActive = false;
      send(false);
    },
  };
}

/** Reports that this person is here while the page is open and visible. */
export function usePresenceBeacon(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const toucher = createPresenceToucher((active) => {
      void rpc.presence.touch({ active }).catch(() => undefined);
    });
    const sync = () =>
      document.visibilityState === "hidden" ? toucher.inactive() : toucher.active();
    const interact = () => {
      if (document.visibilityState !== "hidden") toucher.active();
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    for (const type of ["pointerdown", "keydown", "focus"]) {
      window.addEventListener(type, interact, { passive: true });
    }
    return () => {
      document.removeEventListener("visibilitychange", sync);
      for (const type of ["pointerdown", "keydown", "focus"]) {
        window.removeEventListener(type, interact);
      }
    };
  }, [enabled]);
}

/** Each member's presence by user id, kept fresh by the space stream. */
export function usePresence(): ReadonlyMap<string, PresenceStatus> {
  const queries = useSpaceQueries();
  const query = useQuery(queries.presence.list.queryOptions({ input: {} }));
  useSpaceHint("presence", () => void query.refetch());
  return useMemo(
    () => new Map((query.data ?? []).map((entry) => [entry.userId, entry.status])),
    [query.data],
  );
}
