import { urlsInText } from "@corvo/core";
import type { RunContext } from "./run-context.js";

const MAX_PRIVATE_CHARS = 1_000_000;
const MAX_RESULT_CHARS = 200_000;
const MAX_KNOWN_URLS = 5_000;
/** Results of the public web: a page anyone can read holds no private data to leak. */
const PUBLIC_RESULT_TOOLS = new Set(["web_search", "web_fetch"]);

/** The text leaves of a tool result, as the agent read them (not their JSON escaping). */
export function resultText(value: unknown, depth = 0): string {
  if (typeof value === "string") return value;
  if (depth > 6 || value === null || typeof value !== "object") {
    return typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }
  const parts: string[] = [];
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    const text = resultText(entry, depth + 1);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

/** Remember what a tool returned, so a later URL can be checked against it. */
export function notePrivateResult(ctx: RunContext, toolName: string, result: unknown) {
  const text = resultText(result);
  if (!text) return;
  // A URL a result holds is one the agent was given, public page or not.
  addKnownUrls(ctx, text);
  if (!PUBLIC_RESULT_TOOLS.has(toolName)) addPrivateText(ctx, text);
}

export function addKnownUrls(ctx: RunContext, text: string) {
  const { knownUrls } = ctx.state.egress;
  for (const url of urlsInText(
    text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) : text,
  )) {
    if (knownUrls.size < MAX_KNOWN_URLS) knownUrls.add(url);
  }
}

export function addPrivateText(ctx: RunContext, text: string) {
  if (!text) return;
  const egress = ctx.state.egress;
  const kept = text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) : text;
  egress.privateText.push(kept);
  egress.privateChars += kept.length;
  while (egress.privateChars > MAX_PRIVATE_CHARS && egress.privateText.length > 1) {
    egress.privateChars -= egress.privateText.shift()!.length;
  }
}
