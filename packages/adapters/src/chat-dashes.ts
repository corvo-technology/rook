// Code spans and fences, left untouched. An unclosed fence runs to the end of the text.
const CODE = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;
// A spaced dash between two words. Table cells and list markers have a pipe or a line
// start next to the dash, so they never match.
const SPACED_DASH = /(?<=[^\s|]) [—–] (?=[^\s|])/g;

/** Agents write chat like a person talks: a spaced em or en dash becomes a comma. */
export function replaceSpacedDashes(text: string): string {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(SPACED_DASH, ", ")))
    .join("");
}
