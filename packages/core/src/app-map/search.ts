import { APP_CATALOG } from "../app-catalog-data.js";
import { APP_MAP_SCREENS } from "./screens.js";
import type { AppMapAudience, AppMapEntry, AppMapLocale, AppMapSurface } from "./types.js";

/** Bump when the shape of the map or its ranking changes. */
export const APP_MAP_VERSION = 1;

const CONNECT_PATH = "/settings/connections";

const CONNECT_LEAD: Record<AppMapLocale, string> = {
  en: "Connect",
  "pt-BR": "Conectar",
};
const CONNECT_KEYWORDS: Record<AppMapLocale, readonly string[]> = {
  en: ["connect", "app", "integration", "add", "link", "sign in"],
  "pt-BR": ["conectar", "app", "integração", "adicionar", "vincular", "entrar"],
};

/**
 * The whole map: the screens, plus one entry per connectable app of the app catalog, so a new
 * catalog app is findable without touching this file.
 */
export function appMap(): AppMapEntry[] {
  const apps = APP_CATALOG.map((app): AppMapEntry => {
    const surfaces: AppMapSurface[] = app.desktopOnly ? ["desktop"] : ["web", "desktop", "mobile"];
    const text = (locale: AppMapLocale) => ({
      title: `${CONNECT_LEAD[locale]} ${app.name}`,
      description: app.tagline,
      keywords: [app.name, app.slug, app.category, ...CONNECT_KEYWORDS[locale]],
    });
    return {
      id: `connect-${app.slug}`,
      path: CONNECT_PATH,
      audience: "member",
      surfaces,
      text: { en: text("en"), "pt-BR": text("pt-BR") },
    };
  });
  return [...APP_MAP_SCREENS, ...apps];
}

export interface AppMapViewer {
  /** The space's owner or an administrator. */
  owner: boolean;
  /** Manages a partner (the partner console). */
  partner: boolean;
}

export function canOpen(audience: AppMapAudience, viewer: AppMapViewer): boolean {
  if (audience === "member") return true;
  if (audience === "owner") return viewer.owner;
  return viewer.owner && viewer.partner;
}

export interface AppMapMatch {
  title: string;
  what: string;
  /** App-relative link, shown as a markdown link. */
  link: string;
  surfaces: readonly AppMapSurface[];
}

export interface AppMapLocked {
  title: string;
  what: string;
  /** Who can open it, in plain words, so the answer names them instead of pointing at the screen. */
  availableTo: "space owners and admins" | "partners";
}

export type AppMapResult = {
  matches: AppMapMatch[];
  locked: AppMapLocked[];
};

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "of",
  "in",
  "on",
  "my",
  "me",
  "i",
  "do",
  "does",
  "how",
  "can",
  "is",
  "it",
  "are",
  "and",
  "or",
  "for",
  "where",
  "what",
  "with",
  "rook",
  "corvo",
  "app",
  "um",
  "uma",
  "o",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "para",
  "por",
  "com",
  "que",
  "como",
  "onde",
  "posso",
  "meu",
  "minha",
  "eu",
  "se",
  "e",
  "ou",
  "ao",
]);

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
}

function queryTokens(query: string): string[] {
  const all = words(query);
  const kept = all.filter((word) => !STOPWORDS.has(word));
  return [...new Set(kept.length > 0 ? kept : all)];
}

function textScore(token: string, entry: AppMapEntry, locale: AppMapLocale): number {
  const { title, keywords } = entry.text[locale];
  let score = 0;
  const titleWords = words(title);
  if (titleWords.includes(token)) score += 6;
  else if (token.length >= 4 && normalize(title).includes(token)) score += 4;
  for (const keyword of keywords) {
    const keywordWords = words(keyword);
    if (keywordWords.includes(token)) score += 4;
    else if (token.length >= 4 && normalize(keyword).includes(token)) score += 2;
  }
  return score;
}

/** A description only breaks ties: a few words match many entries, so it counts at most twice. */
function descriptionScore(
  tokens: readonly string[],
  entry: AppMapEntry,
  locale: AppMapLocale,
): number {
  const descriptionWords = words(entry.text[locale].description);
  const hits = tokens.filter(
    (token) => token.length >= 3 && descriptionWords.some((word) => word.startsWith(token)),
  );
  return Math.min(hits.length, 2);
}

function score(tokens: readonly string[], entry: AppMapEntry, locale: AppMapLocale): number {
  // Both languages count, so an English question finds a screen in a Portuguese app and back.
  const other: AppMapLocale = locale === "en" ? "pt-BR" : "en";
  let total = 0;
  for (const token of tokens) {
    total += Math.max(textScore(token, entry, locale), textScore(token, entry, other));
  }
  return (
    total +
    Math.max(descriptionScore(tokens, entry, locale), descriptionScore(tokens, entry, other))
  );
}

export function appMapLocale(language: unknown): AppMapLocale {
  return typeof language === "string" && language.trim().toLowerCase().startsWith("pt")
    ? "pt-BR"
    : "en";
}

/**
 * Deterministic search over titles, keywords and descriptions. Screens the viewer cannot open come
 * back as `locked` with who can, never as a link.
 */
export function findInApp(input: {
  query: string;
  language?: unknown;
  viewer: AppMapViewer;
  limit?: number;
  entries?: readonly AppMapEntry[];
}): AppMapResult {
  const locale = appMapLocale(input.language);
  const tokens = queryTokens(input.query);
  const limit = input.limit ?? 5;
  const ranked = (input.entries ?? appMap())
    .map((entry, order) => ({ entry, order, score: score(tokens, entry, locale) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const matches: AppMapMatch[] = [];
  const locked: AppMapLocked[] = [];
  for (const { entry } of ranked) {
    const { title, description } = entry.text[locale];
    if (canOpen(entry.audience, input.viewer)) {
      if (matches.length < limit) {
        matches.push({ title, what: description, link: entry.path, surfaces: entry.surfaces });
      }
    } else if (locked.length < 2) {
      locked.push({
        title,
        what: description,
        availableTo: entry.audience === "partner" ? "partners" : "space owners and admins",
      });
    }
  }
  return { matches, locked };
}
