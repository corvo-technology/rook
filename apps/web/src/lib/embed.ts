import type { HostAction, HostContext } from "@corvo/contracts";
import { HostActionSchema, HostContextSchema } from "@corvo/contracts";
import type { UiLocale } from "./ui-locale";
import { normalizeUiLocale } from "./ui-locale";

export type EmbedTheme = "light" | "dark" | "auto";

/** How the partner names its assistant and the person using it; none of it is Rook's. */
export interface EmbedBrand {
  /** The assistant's name in the partner's product. */
  assistant: string | null;
  /** An https address for the assistant's icon. */
  icon: string | null;
  /** What the signed-in person is called, for the greeting and their messages. */
  user: string | null;
}

export interface EmbedLaunch {
  code: string | null;
  theme: EmbedTheme;
  locale: UiLocale | null;
  /** The partner's main colour as `#rrggbb`, or null to keep the app's own. */
  accent: string | null;
  brand: EmbedBrand;
}

export type EmbedMessage =
  | {
      type: "config";
      theme: EmbedTheme | null;
      locale: UiLocale | null;
      accent: string | null;
      brand: EmbedBrand;
    }
  | { type: "code"; code: string }
  /** Where the person is in the partner's product, or null when the page cleared it. */
  | { type: "context"; context: HostContext | null }
  | { type: "actions"; actions: HostAction[] }
  /** The person typed in the partner's own quick-ask box. */
  | { type: "ask"; text: string }
  /** How a confirmed action went in the partner's page. */
  | { type: "action-result"; id: string; ok: boolean; result: string | null };

const THEMES: readonly string[] = ["light", "dark", "auto"];

/** True for the whole life of a page that was opened as the partner's frame. */
let embedded = typeof location !== "undefined" && /^\/embed(\/|$)/.test(location.pathname);
/** The launcher's frame: the chat alone, with the partner's own chrome around it. */
let compact =
  embedded && new URLSearchParams(location.hash.replace(/^#/, "")).get("mode") === "compact";

export const isEmbedded = (): boolean => embedded;
export const isCompactEmbed = (): boolean => compact;

function theme(value: string | null): EmbedTheme | null {
  return value && THEMES.includes(value) ? (value as EmbedTheme) : null;
}

/** A short plain name: trimmed, one line, never longer than `max`. */
function label(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text || null;
}

/** Only a web address an image can load from. */
function iconUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** The partner's names for the assistant and the person, from the page's launch or config. */
export function parseEmbedBrand(raw: {
  assistant?: unknown;
  icon?: unknown;
  user?: unknown;
}): EmbedBrand {
  return {
    assistant: label(raw.assistant, 60),
    icon: iconUrl(raw.icon),
    user: label(raw.user, 80),
  };
}

/** Only a language the app ships; a regional tag reads as its language, anything else as none. */
function locale(value: string | null): UiLocale | null {
  if (!value) return null;
  const matched = normalizeUiLocale(value);
  return matched === "en" && !/^en([-_]|$)/i.test(value) ? null : matched;
}

/** Only a plain six-digit hex colour, so the value can never carry style rules. */
function accent(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

/**
 * The tokens a partner's accent replaces. Everything but the accent itself is derived from it by
 * the browser: the text on it turns light or dark by its lightness so it stays readable, hover is
 * a touch darker, and disabled is a faint wash.
 */
export function accentTokens(hex: string): Record<string, string> {
  return {
    "--primary": hex,
    "--primary-foreground": "oklch(from var(--primary) clamp(0, calc((0.62 - l) * 1000), 1) 0 0)",
    "--primary-hover": "color-mix(in srgb, var(--primary) 88%, black)",
    "--primary-disabled": "color-mix(in srgb, var(--primary) 16%, transparent)",
  };
}

/** What the embedding page asked for, and what the partner set for itself; the page's wins. */
let pageAccent: string | null = null;
let partnerAccent: string | null = null;

/** Applies the embedding page's accent, or the partner's own, or the app's colours when neither. */
export function applyEmbedAccent(hex: string | null): void {
  pageAccent = hex;
  paintAccent();
}

/** The accent the partner set in its template, used only when the embedding page passes none. */
export function applyPartnerAccent(hex: string | null): void {
  partnerAccent = hex ? accent(hex) : null;
  paintAccent();
}

function paintAccent(): void {
  const hex = pageAccent ?? partnerAccent;
  const style = document.documentElement.style;
  const names = ["--primary", "--primary-foreground", "--primary-hover", "--primary-disabled"];
  if (!hex) {
    for (const name of names) style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(accentTokens(hex))) style.setProperty(name, value);
}

/**
 * What the partner's page asked for, from the address fragment. The fragment is never sent to a
 * server or logged, which is why the one-use code travels in it.
 */
export function parseEmbedLaunch(hash: string): EmbedLaunch {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    code: params.get("code") || null,
    theme: theme(params.get("theme")) ?? "auto",
    locale: locale(params.get("locale")),
    accent: accent(params.get("accent")),
    brand: parseEmbedBrand({
      assistant: params.get("assistant"),
      icon: params.get("icon"),
      user: params.get("user"),
    }),
  };
}

/**
 * The only things the partner's page may tell the frame: how it looks, and a fresh one-use code
 * when the frame asked for one. Nothing here can carry a token or touch the session.
 */
export function parseEmbedMessage(data: unknown): EmbedMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type === "corvo:config") {
    return {
      type: "config",
      theme: typeof message.theme === "string" ? theme(message.theme) : null,
      locale: typeof message.locale === "string" ? locale(message.locale) : null,
      accent: accent(message.accent),
      brand: parseEmbedBrand(message),
    };
  }
  if (message.type === "corvo:code" && typeof message.code === "string" && message.code) {
    return { type: "code", code: message.code };
  }
  if (message.type === "corvo:context") {
    if (message.context === null) return { type: "context", context: null };
    const context = HostContextSchema.safeParse(message.context);
    return context.success ? { type: "context", context: context.data } : null;
  }
  if (message.type === "corvo:actions" && Array.isArray(message.actions)) {
    const actions = message.actions.flatMap((item) => {
      const parsed = HostActionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return { type: "actions", actions };
  }
  if (message.type === "corvo:ask" && typeof message.text === "string") {
    const text = message.text.trim().slice(0, 2000);
    return text ? { type: "ask", text } : null;
  }
  if (
    message.type === "corvo:action-result" &&
    typeof message.id === "string" &&
    typeof message.ok === "boolean"
  ) {
    return {
      type: "action-result",
      id: message.id,
      ok: message.ok,
      result: typeof message.result === "string" ? message.result.slice(0, 300) : null,
    };
  }
  return null;
}

let token: string | null = null;

/** The frame's session token, or undefined outside an embedded frame. */
export const embedToken = (): string | undefined => token ?? undefined;
let wrapped = false;
let originalFetch: typeof fetch | null = null;

function isAppRequest(url: string): boolean {
  try {
    const parsed = new URL(url, location.origin);
    return parsed.origin === location.origin && /^\/(api|rpc)(\/|$)/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Signs this frame's requests with the session token. A frame inside another site cannot keep a
 * cookie, so the token stays in memory and every request to this app carries it as a bearer.
 */
export function installEmbedToken(next: string): void {
  token = next;
  if (wrapped) return;
  wrapped = true;
  originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!token || !isAppRequest(url)) return originalFetch!(input, init);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set("authorization", `Bearer ${token}`);
    return originalFetch!(input instanceof Request ? new Request(input, { headers }) : input, {
      ...init,
      headers,
    });
  };
}

/** Test-only: forget the token and unwrap fetch. */
export function resetEmbedForTests(): void {
  token = null;
  if (wrapped && originalFetch) window.fetch = originalFetch;
  wrapped = false;
  originalFetch = null;
  embedded = false;
  compact = false;
}

/** What the page was opened with; read once, because the fragment is cleared right after. */
export const initialEmbedLaunch: EmbedLaunch | null = embedded
  ? parseEmbedLaunch(location.hash)
  : null;

/** Takes the code out of the address bar so it is never kept in history or shared. */
export function clearEmbedFragment(): void {
  history.replaceState(null, "", location.pathname + location.search);
}

export type FrameMessage =
  | { type: "corvo:refresh" | "corvo:expired" | "corvo:ready" | "corvo:escape" }
  | { type: "corvo:checkout"; url: string }
  | { type: "corvo:navigate"; path: string }
  | { type: "corvo:unread"; count: number }
  | {
      type: "corvo:action";
      id: string;
      name: string;
      params: Record<string, string | number | boolean>;
    };

/** Tells the partner's page something about the frame; it never carries the token. */
export function tellParent(message: FrameMessage) {
  if (window.parent !== window) window.parent.postMessage(message, "*");
}

/** Only a web address a person can pay at. */
export function isCheckoutUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** A path inside the partner's product: absolute, and never another site. */
export function isHostPath(value: string): boolean {
  return /^\/(?!\/)[^\s\\]*$/.test(value);
}

/**
 * Sends the person to the partner's checkout. Framed, the page that embeds Rook decides (its
 * `corvo-checkout` event, which opens the address in the top window by default); alone, the
 * address opens in a new tab.
 */
export function openCheckout(url: string): void {
  if (!isCheckoutUrl(url)) return;
  if (window.parent !== window) tellParent({ type: "corvo:checkout", url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

/** Asks the partner's page to open a place in its own product, such as a recording screen. */
export function openInHost(path: string): void {
  if (isHostPath(path)) tellParent({ type: "corvo:navigate", path });
}

/** Tells the partner's page how many things wait, so it can badge its own menu. */
export function reportUnread(count: number): void {
  tellParent({ type: "corvo:unread", count: Math.max(0, Math.floor(count)) });
}

export interface EmbedSession {
  token: string;
  expiresAt: string | null;
}

/** Trades the one-use code for the frame's session token; null for any refusal. */
export async function exchangeEmbedCode(code: string): Promise<EmbedSession | null> {
  try {
    const response = await fetch("/api/partner/embed/exchange", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<EmbedSession>;
    return typeof body.token === "string"
      ? { token: body.token, expiresAt: body.expiresAt ?? null }
      : null;
  } catch {
    return null;
  }
}

let refreshTimer: number | undefined;
const REFRESH_LEAD_MS = 10 * 60_000;

/** Asks the partner's page for a new code shortly before the session ends. */
export function scheduleEmbedRefresh(expiresAt: string | null): void {
  window.clearTimeout(refreshTimer);
  const end = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(end)) return;
  refreshTimer = window.setTimeout(
    () => tellParent({ type: "corvo:refresh" }),
    Math.max(end - Date.now() - REFRESH_LEAD_MS, 0),
  );
}
