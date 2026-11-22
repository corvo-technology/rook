import { unzipSync } from "fflate";
import { buildSkillMd, parseSkillMd } from "./agent-skill.js";

/** The only hosts a skill link may point at. */
export const SKILL_IMPORT_HOSTS: readonly string[] = ["github.com", "raw.githubusercontent.com"];
/** A SKILL.md larger than this is refused, from a link or from inside a zip. */
export const SKILL_IMPORT_MAX_BYTES = 100_000;
/** Entries a zip may list before it is refused, whatever they are. */
export const SKILL_ZIP_MAX_ENTRIES = 200;
const SKILL_FILE = "SKILL.md";
const URL_MAX_LENGTH = 2048;
// A GitHub account, repo, ref or folder name: no dots-only segments, no encoded separators.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~+@-]*$/;
const FOLDER_SEGMENT = /^[A-Za-z0-9._~+@-]+$/;

export type SkillImportResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function safePath(segments: string[]): boolean {
  return segments.every((segment) => FOLDER_SEGMENT.test(segment) && !/^\.+$/.test(segment));
}

/**
 * The raw file to read for a GitHub link: a repository, a folder (`/tree/<ref>/<folder>`), a
 * file (`/blob/<ref>/<folder>/SKILL.md`) or a raw link. Only https on github.com or
 * raw.githubusercontent.com, no credentials and no port. A branch name with a slash is not
 * supported: the ref is the first segment after `tree` or `blob`.
 */
export function skillRawUrl(input: string): SkillImportResult<{ url: string }> {
  const text = input.trim();
  if (!text || text.length > URL_MAX_LENGTH) return fail("Paste a GitHub link.");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("Paste a GitHub link.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return fail("Only https links to GitHub are accepted.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!SKILL_IMPORT_HOSTS.includes(host)) return fail("Only links to GitHub are accepted.");
  const parts = url.pathname.split("/").filter(Boolean);

  let owner: string | undefined;
  let repo: string | undefined;
  let ref = "HEAD";
  let rest: string[] = [];
  if (host === "raw.githubusercontent.com") {
    [owner, repo, ref = "", ...rest] = parts;
    if (!ref) return fail("The link does not point to a skill.");
  } else {
    [owner, repo] = parts;
    repo = repo?.replace(/\.git$/, "");
    const kind = parts[2];
    if (kind !== undefined) {
      if (kind !== "tree" && kind !== "blob") return fail("The link does not point to a skill.");
      if (!parts[3]) return fail("The link does not point to a skill.");
      ref = parts[3];
      rest = parts.slice(4);
    }
  }
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    return fail("The link does not point to a skill.");
  }
  if (!safePath([ref])) return fail("The link does not point to a skill.");
  if (rest.at(-1) === SKILL_FILE) {
    // keep as is
  } else if (rest.at(-1)?.toLowerCase().endsWith(".md")) {
    return fail("The link must point to a skill folder or its SKILL.md.");
  } else {
    rest = [...rest, SKILL_FILE];
  }
  if (!safePath(rest)) return fail("The link does not point to a skill.");
  return {
    ok: true,
    url: `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rest.join("/")}`,
  };
}

// Control characters other than tab and newline never belong in a skill; NUL most of all.
// biome-ignore lint/suspicious/noControlCharactersInRegex: this is the point.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LINE_SEPARATORS = /[\u2028\u2029\r\n\t]+/g;

/**
 * A skill read from outside, normalized into the stored form: name and description on one line
 * without control characters, frontmatter rebuilt by the same writer as every other skill.
 */
export function normalizeImportedSkill(markdown: string): SkillImportResult<{ content: string }> {
  const text = markdown.replace(CONTROL, "");
  if (text.length > SKILL_IMPORT_MAX_BYTES) return fail("The skill is too large.");
  const parsed = parseSkillMd(text);
  if ("error" in parsed) return fail("That is not a skill: it needs a name and a description.");
  const name = parsed.name.replace(CONTROL, "").replace(LINE_SEPARATORS, " ").trim();
  const description = parsed.description.replace(CONTROL, "").replace(LINE_SEPARATORS, " ").trim();
  if (!name || !description) return fail("That is not a skill: it needs a name and a description.");
  try {
    const content = buildSkillMd({ ...parsed, name, description });
    if (content.length > SKILL_IMPORT_MAX_BYTES) return fail("The skill is too large.");
    return { ok: true, content };
  } catch {
    return fail("That is not a skill: it needs a name and a description.");
  }
}

function unsafeEntry(name: string): boolean {
  return (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").includes("..")
  );
}

/**
 * The SKILL.md of a zipped skill folder. Only that one text file is read, and the nearest to the
 * top wins; scripts and other files in the archive are never extracted or kept. An archive with
 * a path that escapes its folder, more than `SKILL_ZIP_MAX_ENTRIES` entries or no SKILL.md is
 * refused.
 */
export function skillFromZip(data: Uint8Array): SkillImportResult<{ content: string }> {
  const unreadable = "That file is not a readable .zip.";
  let unsafe = false;
  let tooMany = false;
  let seen = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => {
        seen += 1;
        if (seen > SKILL_ZIP_MAX_ENTRIES) {
          tooMany = true;
          return false;
        }
        if (unsafeEntry(file.name)) {
          unsafe = true;
          return false;
        }
        const isSkill = file.name.split("/").at(-1) === SKILL_FILE;
        if (!isSkill || file.originalSize > SKILL_IMPORT_MAX_BYTES) return false;
        return true;
      },
    });
  } catch {
    return fail(unreadable);
  }
  if (tooMany) return fail("That .zip has too many files.");
  if (unsafe) return fail("That .zip has files outside its folder.");
  const path = Object.keys(entries).sort(
    (a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1),
  )[0];
  const bytes = path === undefined ? undefined : entries[path];
  if (!bytes) return fail("That .zip has no SKILL.md.");
  return normalizeImportedSkill(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
}
