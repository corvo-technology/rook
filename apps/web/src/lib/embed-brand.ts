import { useSyncExternalStore } from "react";
import type { EmbedBrand } from "./embed";

const EMPTY: EmbedBrand = { assistant: null, icon: null, user: null };

/** What the partner's page called the assistant and the person; lives for the frame's life. */
let brand: EmbedBrand = EMPTY;
const listeners = new Set<() => void>();

export const embedBrand = (): EmbedBrand => brand;

export function setEmbedBrand(next: EmbedBrand): void {
  if (next.assistant === brand.assistant && next.icon === brand.icon && next.user === brand.user) {
    return;
  }
  brand = next;
  for (const listener of listeners) listener();
}

export function useEmbedBrand(): EmbedBrand {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => brand,
    () => brand,
  );
}

/** Test-only: forget what the page said. */
export function resetEmbedBrandForTests(): void {
  brand = EMPTY;
  listeners.clear();
}

/** What Rook calls its first agent until the partner names it; never shown inside a partner's product. */
const DEFAULT_CHIEF_NAME = "rook";

/**
 * What the assistant is called inside a partner's product: the name its page passes, else the name
 * the partner gave the Chief in its template, else a neutral label. Never Rook's own name.
 */
export function embedAssistantName(
  brand: EmbedBrand,
  chiefName: string | undefined,
  fallback: string,
): string {
  if (brand.assistant) return brand.assistant;
  const named = chiefName?.trim();
  return named && named.toLowerCase() !== DEFAULT_CHIEF_NAME ? named : fallback;
}
