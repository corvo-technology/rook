import { wikiSlug } from "./wiki.js";
import type { CuratorOp } from "./wiki-curator.js";

/** How much of a document one model call reads. */
export const WIKI_IMPORT_PART_CHARS = 12_000;
/** The most parts one file is read in; what comes after is left out, and the person is told. */
export const WIKI_IMPORT_MAX_PARTS = 30;

export type DocumentPart = { label: string; text: string };

/** A piece of a document with a name a quote can cite: a page of a PDF, or a stretch of a text file. */
export type DocumentSection = { label: string; text: string };

/** Cuts text on blank lines, and on line breaks or spaces when one paragraph is too long. */
function cut(text: string, size: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const at = Math.max(
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(" "),
    );
    const end = at > size / 2 ? at : size;
    pieces.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** The pages of a PDF as sections: "p. 3". A page with no text is left out. */
export const pdfSections = (pages: readonly string[]): DocumentSection[] =>
  pages.flatMap((text, index) => (text.trim() ? [{ label: `p. ${index + 1}`, text }] : []));

/** A text file as sections of about one part each: "part 2". */
export const textSections = (text: string): DocumentSection[] =>
  cut(text, WIKI_IMPORT_PART_CHARS).map((piece, index) => ({
    label: `part ${index + 1}`,
    text: piece,
  }));

/**
 * Groups sections into parts of at most `size` characters, in order, each part named by the first and
 * last section it holds ("p. 3-5"). A section longer than a part is cut and keeps its label.
 * `truncated` is true when more parts were needed than `maxParts`.
 */
export function documentParts(
  sections: readonly DocumentSection[],
  options: { size?: number; maxParts?: number } = {},
): { parts: DocumentPart[]; truncated: boolean } {
  const size = options.size ?? WIKI_IMPORT_PART_CHARS;
  const maxParts = options.maxParts ?? WIKI_IMPORT_MAX_PARTS;
  const parts: DocumentPart[] = [];
  let held: DocumentSection[] = [];
  let length = 0;
  const flush = () => {
    if (!held.length) return;
    const first = held[0]!.label;
    const last = held.at(-1)!.label;
    const range = first === last ? first : `${first}-${last.replace(/^p\. /, "")}`;
    parts.push({
      label: range,
      text: held.map((section) => `[${section.label}]\n${section.text}`).join("\n\n"),
    });
    held = [];
    length = 0;
  };
  for (const section of sections) {
    for (const text of cut(section.text, size)) {
      if (length && length + text.length > size) flush();
      held.push({ label: section.label, text });
      length += text.length;
    }
  }
  flush();
  return { parts: parts.slice(0, maxParts), truncated: parts.length > maxParts };
}

/** Said to the model after the curator's rules when it reads a file instead of a conversation. */
export function documentCuratorInstructions(file: string): string {
  return [
    `The text is a part of the file "${file}", not a conversation: the author lines name the part, and [p. N] or [part N] markers inside it show where each passage came from. Keep the knowledge in it as pages.`,
    `Cite the source on every fact you keep, at the end of its sentence or bullet, as (Source: ${file}, p. N) or (Source: ${file}, part N), using the marker the passage sits under. A fact with no marker is cited by the part name.`,
    'Several parts of one file come one after the other. "Changes waiting" lists pages already planned from earlier parts: append to them instead of creating them again.',
    "Do not copy the file out. Keep what the team will want again, short, in your own words.",
  ].join("\n");
}

/**
 * Operations from several parts of one file as one list. A page the file already started is added to,
 * never created twice, and a `replace` of a page the file made itself is dropped: the file's own
 * earlier text is not "old" knowledge.
 */
export function mergeImportOps(partOps: readonly CuratorOp[][]): CuratorOp[] {
  const created = new Set<string>();
  const merged: CuratorOp[] = [];
  for (const ops of partOps) {
    for (const op of ops) {
      const key = wikiSlug(op.page);
      if (op.op === "create" && created.has(key)) {
        merged.push({ op: "append", page: op.page, text: op.body });
      } else if (op.op === "replace" && created.has(key)) {
      } else {
        merged.push(op);
        if (op.op === "create") created.add(key);
      }
    }
  }
  return merged;
}
