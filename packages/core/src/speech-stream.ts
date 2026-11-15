import { SENTENCE_END, toUtterances } from "./speech-text.js";

/** The first chunk of a turn may stop at a comma this far in, so audio starts sooner. */
const FIRST_CLAUSE_CHARS = 40;
const CLAUSE_END = /[,;]["')\]]*(?=\s)/g;

export interface SpeechChunker {
  /** The reply written so far; returns the chunks completed since the last call. */
  push(written: string): string[];
  /** The reply is done; returns everything still unspoken, however unfinished. */
  flush(written: string): string[];
  /** Text up to here was never meant to be spoken (the caller cut it off). */
  skipTo(written: string): void;
}

/** Joining lines into speech leaves stray stops and emphasis marks at the seams of a chunk. */
function tidy(chunk: string): string {
  return chunk
    .replace(/\*{2,}/g, "")
    .replace(/([.!?:;,])\.(?=\s|$)/g, "$1")
    .replace(/^[.\s]+/, "")
    .trim();
}

/** Where an unclosed code fence begins, which nothing after may be spoken from yet. */
function openFence(text: string): number | undefined {
  let open: number | undefined;
  for (const marker of ["```", "~~~"]) {
    const at = [...text.matchAll(new RegExp(marker, "g"))].map((match) => match.index);
    if (at.length % 2 === 1) {
      const start = at[at.length - 1];
      if (start !== undefined && (open === undefined || start < open)) open = start;
    }
  }
  return open;
}

/**
 * Cuts a reply that is still being written into pieces a voice can start on. Only text that
 * is certainly complete is released (a full sentence, a line, a closed code block), so a
 * chunk never ends mid-abbreviation or mid-number. The first chunk of a turn may be a short
 * clause. Text that stops being a continuation of what was already released is ignored.
 */
export function createSpeechChunker(): SpeechChunker {
  let released = "";
  let spoke = false;
  /** Skipped text stopped mid-sentence: what remains of that sentence is skipped too. */
  let finishingSkipped = false;

  const remainder = (written: string): string | undefined => {
    if (!written.startsWith(released)) return undefined;
    let rest = written.slice(released.length);
    if (finishingSkipped) {
      const end = [...rest.matchAll(SENTENCE_END)][0];
      const line = rest.search(/\n(?=[^\n])/);
      const cut = Math.min(
        end ? end.index + end[0].length : Number.POSITIVE_INFINITY,
        line >= 0 ? line + 1 : Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(cut)) return undefined;
      finishingSkipped = false;
      released = written.slice(0, released.length + cut);
      rest = rest.slice(cut);
    }
    return rest;
  };

  const take = (written: string, length: number): string[] => {
    const piece = written.slice(released.length, released.length + length);
    released = written.slice(0, released.length + length);
    const chunks = toUtterances(piece).map(tidy);
    const spoken = chunks.filter(Boolean);
    if (spoken.length > 0) spoke = true;
    return spoken;
  };

  return {
    push(written) {
      const rest = remainder(written);
      if (rest === undefined) return [];
      const fence = openFence(rest);
      const region = fence === undefined ? rest : rest.slice(0, fence);
      const ends = [...region.matchAll(SENTENCE_END)].map((m) => m.index + m[0].length);
      for (const newline of region.matchAll(/\n(?=[^\n])/g)) ends.push(newline.index + 1);
      if (fence !== undefined) ends.push(region.length);
      ends.sort((a, b) => a - b);
      // A line break inside a code block is not a place to stop.
      for (let i = ends.length - 1; i >= 0; i -= 1) {
        if (openFence(rest.slice(0, ends[i])) !== undefined) ends.splice(i, 1);
      }
      let cut = ends.at(-1);
      if (!spoke) {
        const clause = [...region.matchAll(CLAUSE_END)]
          .map((m) => m.index + m[0].length)
          .find((end) => end >= FIRST_CLAUSE_CHARS);
        const first = ends[0];
        if (clause !== undefined && (first === undefined || clause < first)) cut = clause;
      }
      if (!cut) return [];
      return take(written, cut);
    },
    flush(written) {
      const rest = remainder(written);
      if (rest === undefined) return [];
      return take(written, rest.length);
    },
    skipTo(written) {
      released = written;
      finishingSkipped = !/(?:[.!?]["')\]]*\s*|\n)$/.test(written);
    },
  };
}
