export type ReportSource = { position: number; title: string; url: string };

const CITATION = /\[(\d{1,3})\]/g;

/** The source numbers a report cites, in the order they first appear. */
export function citedPositions(text: string): number[] {
  const seen: number[] = [];
  for (const match of text.matchAll(CITATION)) {
    const position = Number(match[1]);
    if (!seen.includes(position)) seen.push(position);
  }
  return seen;
}

/**
 * Keeps only citations that point at a source the job read, so a number the model made up never
 * reaches the person. Returns how many real citations remain.
 */
export function keepRealCitations(
  text: string,
  sources: readonly ReportSource[],
): { text: string; cited: number[] } {
  const known = new Set(sources.map((source) => source.position));
  const cleaned = text
    .replace(CITATION, (whole, digits: string) => (known.has(Number(digits)) ? whole : ""))
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return { text: cleaned.trim(), cited: citedPositions(cleaned) };
}

/** The report with a list of the sources it cites, written from the ledger and never by the model. */
export function withSourceList(body: string, sources: readonly ReportSource[]): string {
  const cited = new Set(citedPositions(body));
  const lines = sources
    .filter((source) => cited.has(source.position))
    .sort((a, b) => a.position - b.position)
    .map(
      (source) =>
        `[${source.position}] ${source.title.replace(/\s+/g, " ").trim()} - ${source.url}`,
    );
  return lines.length ? `${body}\n\n${lines.join("\n")}` : body;
}

const WHITESPACE = /\s+/g;

/** Whether a quoted passage really appears in the page text, ignoring case and spacing. */
export function quoteAppearsIn(quote: string, pageText: string): boolean {
  const needle = quote.replace(WHITESPACE, " ").trim().toLowerCase();
  if (needle.length < 12) return false;
  return pageText.replace(WHITESPACE, " ").toLowerCase().includes(needle);
}

/** The first JSON object in a model's answer, whether or not it wrapped it in a code fence. */
export function parseJsonObject(answer: string): unknown {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(answer.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
