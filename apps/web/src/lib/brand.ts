import type { PublicBrand } from "@corvo/contracts";
import { PublicBrandResponseSchema } from "@corvo/contracts";
import { useSyncExternalStore } from "react";
import { applyPartnerAccent } from "./embed";

/**
 * White label: the app on a partner's host takes that partner's name, icon, colour and legal
 * links. The API picks the brand from the host the page was served on, so this reads it once at
 * boot; there is no parameter and no setting that changes it. An unknown host, or a failed read,
 * leaves the app's own look.
 */

/** What the app calls itself when no partner's brand is active. */
export const APP_NAME = "Rook";

const BRAND_URL = "/api/brand";
const MANIFEST_URL = "/api/brand/manifest.webmanifest";

let current: PublicBrand | null = null;
const listeners = new Set<() => void>();

export const currentBrand = (): PublicBrand | null => current;

function setBrand(brand: PublicBrand | null) {
  current = brand;
  for (const listener of listeners) listener();
}

/** The active partner brand, or null on the app's own host. */
export function useBrand(): PublicBrand | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

/** The name to show: the partner's when a brand is active, the app's own otherwise. */
export function useAppName(): string {
  return useBrand()?.name ?? APP_NAME;
}

export async function loadBrand(
  request: typeof fetch = fetch,
  timeoutMs = 2_500,
): Promise<PublicBrand | null> {
  try {
    const response = await request(BRAND_URL, {
      signal: AbortSignal.timeout(timeoutMs),
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const parsed = PublicBrandResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.brand : null;
  } catch {
    return null;
  }
}

function head(doc: Document, selector: string, create: () => HTMLElement): HTMLElement {
  const found = doc.head.querySelector<HTMLElement>(selector);
  if (found) return found;
  const made = create();
  doc.head.append(made);
  return made;
}

function setMeta(doc: Document, name: string, content: string) {
  head(doc, `meta[name="${name}"]`, () => {
    const meta = doc.createElement("meta");
    meta.name = name;
    return meta;
  }).setAttribute("content", content);
}

/**
 * Paints a brand onto the page: title, favicon, home-screen icon, `theme-color`, the per-host
 * manifest and the accent. With no icon of its own the page shows none, never the app's.
 */
export function applyBrand(brand: PublicBrand, doc: Document = document): void {
  doc.title = brand.name;
  doc.documentElement.dataset.brand = "";
  setMeta(doc, "description", brand.name);
  setMeta(doc, "apple-mobile-web-app-title", brand.name);
  if (brand.accent) setMeta(doc, "theme-color", brand.accent);
  for (const link of doc.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]'))
    link.remove();
  const icon = (rel: string, href: string) => {
    const link = doc.createElement("link");
    link.rel = rel;
    link.href = href;
    doc.head.append(link);
  };
  // An empty icon keeps the browser from asking the host for the app's own favicon.
  icon("icon", brand.iconUrl ?? "data:,");
  if (brand.iconUrl) icon("apple-touch-icon", brand.iconUrl);
  head(doc, 'link[rel="manifest"]', () => {
    const link = doc.createElement("link");
    link.rel = "manifest";
    return link;
  }).setAttribute("href", MANIFEST_URL);
  applyPartnerAccent(brand.accent);
}

/** Reads the brand for this host and applies it, before the first screen is drawn. */
export async function bootBrand(request: typeof fetch = fetch): Promise<PublicBrand | null> {
  const brand = await loadBrand(request);
  // The page starts with no title, so no partner host ever shows the app's name before its own.
  if (!brand) {
    if (!document.title) document.title = APP_NAME;
    return null;
  }
  setBrand(brand);
  applyBrand(brand);
  return brand;
}

/**
 * A catalog with the app's name replaced by the partner's in every message, so copy written for
 * the app (settings, billing, errors, in any language) reads as the partner's without a variant
 * of each string.
 */
export function rebrandMessages<T>(messages: T, name: string): T {
  const swap = (value: unknown): unknown =>
    typeof value === "string"
      ? value.replace(/\bRook\b/g, () => name)
      : Array.isArray(value)
        ? value.map(swap)
        : value;
  return Object.fromEntries(
    Object.entries(messages as Record<string, unknown>).map(([id, message]) => [id, swap(message)]),
  ) as T;
}

/** For tests: set or clear the brand without touching the page. */
export function setBrandForTest(brand: PublicBrand | null): void {
  setBrand(brand);
}
