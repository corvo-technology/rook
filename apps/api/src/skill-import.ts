import type { SafeWebFetchOptions } from "@corvo/adapters";
import { fetchSafeWebText } from "@corvo/adapters";
import type { SkillImportInput } from "@corvo/contracts";
import {
  normalizeImportedSkill,
  SKILL_IMPORT_MAX_BYTES,
  skillFromZip,
  skillRawUrl,
} from "@corvo/core";
import { ORPCError } from "@orpc/server";

const FETCH_TIMEOUT_MS = 10_000;

/** What an imported skill's fetch may be given in tests: the network and the DNS answer. */
export type SkillImportFetchOptions = Pick<SafeWebFetchOptions, "fetch" | "resolveHostname">;

function refuse(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}

/**
 * The SKILL.md a person asked to add, from a GitHub link or a zip. The link is rewritten to the
 * raw file on github.com / raw.githubusercontent.com, fetched through the SSRF-checked client
 * with no redirects (so a response cannot move the request to another host), a short deadline
 * and a size cap. Nothing but that one text file is kept.
 */
export async function resolveSkillImport(
  input: SkillImportInput,
  options: SkillImportFetchOptions = {},
): Promise<string> {
  if (input.kind === "zip") {
    const result = skillFromZip(Uint8Array.from(Buffer.from(input.dataBase64, "base64")));
    return result.ok ? result.content : refuse(result.error);
  }
  const source = skillRawUrl(input.url);
  if (!source.ok) return refuse(source.error);
  let body: string;
  try {
    ({ body } = await fetchSafeWebText(source.url, {
      ...options,
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: SKILL_IMPORT_MAX_BYTES,
      maxRedirects: 0,
      allowedPorts: [443],
      headers: { accept: "text/plain, text/markdown" },
    }));
  } catch {
    return refuse("Could not read a skill from that link.");
  }
  const result = normalizeImportedSkill(body);
  return result.ok ? result.content : refuse(result.error);
}
