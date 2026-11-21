import { normalizedHttpUrl } from "./egress.js";
import { toolNameWords } from "./tool-risk.js";

/** The longest query string, fragment included, an outbound URL may carry. */
export const MAX_OUTBOUND_QUERY_LENGTH = 512;
/** Characters copied from a private tool result that make a URL a leak. */
export const MIN_COPIED_RESULT_LENGTH = 24;

export type UrlLeakRule = "key" | "query" | "copied";

/** Why an outbound URL was refused. The message tells the agent how to fix the call. */
export type UrlLeakRefusal = { rule: UrlLeakRule; error: string };

const KEY_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/,
  /\bBearer(?:\s|%20|\+)+[A-Za-z0-9._~+/-]{16,}/i,
];
const SECRET_PARAM =
  /(?:^|[_-])(?:key|token|secret|password|passwd|auth|sig|signature|credential|session)s?$/i;
/** A long unbroken value of mixed letters and digits, the shape of a token or digest. */
const TOKEN_VALUE = /^[A-Za-z0-9+/_=-]{32,}$/;

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function looksLikeToken(value: string): boolean {
  return TOKEN_VALUE.test(value) && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function carriesKey(url: URL, secrets: readonly string[]): boolean {
  const forms = [url.href, decoded(url.href)];
  if (KEY_SHAPES.some((shape) => forms.some((form) => shape.test(form)))) return true;
  for (const secret of secrets) {
    if (secret.length >= 6 && forms.some((form) => form.includes(secret))) return true;
  }
  if (url.username || url.password) return true;
  for (const [name, value] of url.searchParams) {
    if (SECRET_PARAM.test(name) && value.length >= 8) return true;
    if (looksLikeToken(value)) return true;
  }
  const fragment = url.hash.replace(/^#/, "");
  return fragment ? looksLikeToken(decoded(fragment)) : false;
}

/** The part of the URL a site cannot already know: its path, query and fragment, decoded. */
function sentText(url: URL): string[] {
  const raw = `${url.pathname}${url.search}${url.hash}`;
  const forms = new Set([raw, decoded(raw)]);
  return [...forms];
}

function copiesPrivateText(url: URL, privateText: readonly string[]): boolean {
  if (privateText.length === 0) return false;
  const corpus = privateText.join("\n");
  for (const form of sentText(url)) {
    for (let at = 0; at + MIN_COPIED_RESULT_LENGTH <= form.length; at += 1) {
      const window = form.slice(at, at + MIN_COPIED_RESULT_LENGTH);
      if (/^(.)\1+$/.test(window)) continue;
      if (corpus.includes(window)) return true;
    }
  }
  return false;
}

/** Every http(s) URL in a text, normalized the way outbound URLs are compared. */
export function urlsInText(text: string): Set<string> {
  const urls = new Set<string>();
  for (const [match] of text.matchAll(/\bhttps?:\/\/[^\s<>"'`\\]+/gi)) {
    // A link ends before the punctuation of the sentence around it; keep both readings.
    for (const candidate of [match, match.replace(/[.,;:!?)\]}]+$/, "")]) {
      const normalized = normalizedHttpUrl(candidate);
      if (normalized) urls.add(normalized);
    }
  }
  return urls;
}

/**
 * Whether an outbound URL could carry data out of the run. Reads are free, so text an injected
 * instruction made the agent read could leave inside a URL: a key-shaped value, a long query, or a
 * stretch copied from a private tool result. A URL that already appeared in the conversation or a
 * tool result is one the agent was given, not one it built, so it passes. Returns null when the
 * URL is fine.
 */
export function outboundUrlLeak(input: {
  url: string;
  /** Text of this run's private tool results (not public web pages). */
  privateText: readonly string[];
  /** Exact URLs the run was given, normalized. */
  knownUrls: { has(url: string): boolean };
  /** Values redacted from this run, such as stored secrets. */
  secrets?: readonly string[];
}): UrlLeakRefusal | null {
  const normalized = normalizedHttpUrl(input.url);
  if (!normalized) return null;
  if (input.knownUrls.has(normalized)) return null;
  const url = new URL(normalized);
  if (carriesKey(url, input.secrets ?? [])) {
    return {
      rule: "key",
      error:
        "This URL carries what looks like a key or token, and a URL is sent to the site it names. Remove it. If the owner gave you this exact URL, use it as they wrote it.",
    };
  }
  if (url.search.length + url.hash.length > MAX_OUTBOUND_QUERY_LENGTH) {
    return {
      rule: "query",
      error: `This URL's query is longer than ${MAX_OUTBOUND_QUERY_LENGTH} characters, which can carry data out. Shorten it, or use a URL exactly as it appeared in the conversation or a tool result.`,
    };
  }
  if (copiesPrivateText(url, input.privateText)) {
    return {
      rule: "copied",
      error: `This URL repeats ${MIN_COPIED_RESULT_LENGTH} or more characters from a private tool result, which can carry data out. Use a URL exactly as it appeared in the conversation or a tool result, without adding anything from them.`,
    };
  }
  return null;
}

/** The longest path a URL may have and still count as carrying no data. */
const MAX_PLAIN_PATH_LENGTH = 120;
const MAX_PLAIN_PATH_SEGMENTS = 8;
/** A name part this long, with no separator, and mixing letters with digits reads as a token. */
const OPAQUE_PART = /^[A-Za-z0-9+/=]{16,}$/;
/** A part of a name copied from the run's private results, at least this long, is data. */
const MIN_SEEN_PART_LENGTH = 8;

function opaquePart(part: string): boolean {
  if (!OPAQUE_PART.test(part)) return false;
  return (/[A-Za-z]/.test(part) && /\d/.test(part)) || /^[0-9a-f]{16,}$/i.test(part);
}

/**
 * Whether a URL could carry data out of a run that outside content has entered: it has a query or
 * fragment, a long or deep path, a part of its host or path that reads as a token, or a part seen
 * in the run's private results. A plain address such as a statute's page carries nothing a site
 * does not already know. Conservative: true when in doubt.
 */
export function urlMayCarryData(input: { url: string; privateText: readonly string[] }): boolean {
  const normalized = normalizedHttpUrl(input.url);
  if (!normalized) return true;
  const url = new URL(normalized);
  if (url.search || url.hash || url.username || url.password) return true;
  const segments = url.pathname.split("/").filter(Boolean);
  if (url.pathname.length > MAX_PLAIN_PATH_LENGTH || segments.length > MAX_PLAIN_PATH_SEGMENTS)
    return true;
  const parts = [...url.hostname.split("."), ...segments.map(decoded)];
  if (parts.some(opaquePart)) return true;
  const corpus = input.privateText.join("\n").toLowerCase();
  if (!corpus) return false;
  return parts.some(
    (part) => part.length >= MIN_SEEN_PART_LENGTH && corpus.includes(part.toLowerCase()),
  );
}

const URL_ARGUMENTS = new Set(["url", "uri", "href", "link", "endpoint", "target"]);
const HTTP_TOOL_WORDS = new Set([
  "http",
  "https",
  "fetch",
  "request",
  "curl",
  "browse",
  "browser",
  "navigate",
  "goto",
  "visit",
  "scrape",
  "crawl",
  "proxy",
]);

/**
 * The URLs a call would send to a site: `web_fetch`, browser navigation and any connector tool
 * that reads as an HTTP client and names a URL.
 */
export function outboundUrlsOfCall(toolName: string, args: unknown): string[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const bare = toolName.startsWith("mcp__")
    ? toolName.split("__").slice(2).join("__") || toolName
    : toolName;
  const httpLike =
    toolName === "web_fetch" ||
    toolName === "browser_navigate" ||
    toolNameWords(bare).some((word) => HTTP_TOOL_WORDS.has(word));
  if (!httpLike) return [];
  return Object.entries(args).flatMap(([key, value]) =>
    URL_ARGUMENTS.has(key.toLowerCase()) && typeof value === "string" && normalizedHttpUrl(value)
      ? [value]
      : [],
  );
}
