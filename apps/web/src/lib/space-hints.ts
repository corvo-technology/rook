import type { SpaceHintKind } from "@corvo/contracts";
import { useEffect, useRef } from "react";

const listeners = new Map<SpaceHintKind, Set<() => void>>();

/** Runs `listener` whenever the space stream says this kind of list changed. */
export function onSpaceHint(kind: SpaceHintKind, listener: () => void): () => void {
  const set = listeners.get(kind) ?? new Set();
  listeners.set(kind, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

export function emitSpaceHint(kind: SpaceHintKind): void {
  for (const listener of [...(listeners.get(kind) ?? [])]) listener();
}

/** Calls `onHint` for every hint of this kind while the component is mounted. */
export function useSpaceHint(kind: SpaceHintKind, onHint: () => void): void {
  const latest = useRef(onHint);
  latest.current = onHint;
  useEffect(() => onSpaceHint(kind, () => latest.current()), [kind]);
}
