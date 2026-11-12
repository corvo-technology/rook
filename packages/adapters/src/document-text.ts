import { getDocumentProxy } from "unpdf";
import {
  extractOfficeText,
  isLegacyOfficeFile,
  type OfficeKind,
  officeKind,
} from "./office-text.js";

/** The most pages read from one PDF; a longer one is read as far as this and says so. */
export const DOCUMENT_MAX_PAGES = 500;
/** How long reading one PDF may take before it is given up on. */
const DOCUMENT_READ_TIMEOUT_MS = 60_000;

/** A document that cannot be read, with a message that says what to do about it. */
export class DocumentTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentTextError";
  }
}

export type DocumentKind = "pdf" | "text" | OfficeKind;

/** What kind of document a file is, by its type or its name; undefined when it cannot be read. */
export function documentKind(name: string, mimeType: string): DocumentKind | undefined {
  if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  const office = officeKind(name, mimeType);
  if (office) return office;
  if (mimeType.startsWith("text/") || mimeType === "application/json") return "text";
  return undefined;
}

/** Why a file cannot be read, with what to do about it. */
export function unsupportedDocumentMessage(name: string, mimeType: string): string {
  return isLegacyOfficeFile(name, mimeType)
    ? "Older Word and Excel files (.doc, .xls) cannot be read. Save it as .docx or .xlsx, or as a PDF, first."
    : `It can read PDF, Word (.docx), Excel (.xlsx), OpenDocument and text files, not ${mimeType || "this kind of file"}.`;
}

export type PdfText = {
  /** The text of each page that was read; a page with no text, such as a scan, is empty. */
  pages: string[];
  totalPages: number;
  /** The document had more pages than were read. */
  truncated: boolean;
};

/**
 * The text of a PDF, read by pdf.js inside this process: no computer, no Docker and no model. A PDF
 * is untrusted input, so the pages read and the time taken are both bounded.
 */
export async function extractPdfText(
  bytes: Uint8Array,
  options: { maxPages?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PdfText> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? DOCUMENT_READ_TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js takes ownership of the buffer it is given, so it is given a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new DocumentTextError(
      name === "PasswordException"
        ? "This PDF is protected by a password, so it cannot be read."
        : "That file is not a readable PDF.",
    );
  }
  try {
    const totalPages = pdf.numPages;
    const limit = Math.min(totalPages, options.maxPages ?? DOCUMENT_MAX_PAGES);
    const pages: string[] = [];
    for (let number = 1; number <= limit; number += 1) {
      signal.throwIfAborted();
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : ""))
          .join("")
          .replace(/[ \t]+/g, " ")
          .trim(),
      );
    }
    return { pages, totalPages, truncated: totalPages > limit };
  } catch (error) {
    if (error instanceof DocumentTextError || signal.aborted) throw error;
    throw new DocumentTextError("That file is not a readable PDF.");
  } finally {
    // Not every build of pdf.js has it; where it exists it frees the document at once.
    await (pdf as { destroy?: () => Promise<void> }).destroy?.()?.catch?.(() => undefined);
  }
}

export type ReadableDocument = {
  /** The whole text, with a marker before each page of a PDF so a quote can name its page. */
  text: string;
  pages: number;
  /** False for a PDF with no text layer, which is what a scanned document is. */
  hasText: boolean;
  /** A very long PDF was read only as far as the page limit. */
  truncated: boolean;
};

/** The text of an attached file, for the kinds of file that have text in them. */
export async function readableDocumentText(
  bytes: Uint8Array,
  name: string,
  mimeType: string,
  options: { signal?: AbortSignal } = {},
): Promise<ReadableDocument> {
  const kind = documentKind(name, mimeType);
  if (kind === "pdf") {
    const pdf = await extractPdfText(bytes, options);
    return {
      text: pdf.pages.map((text, index) => `[page ${index + 1}]\n${text}`).join("\n\n"),
      pages: pdf.totalPages,
      hasText: pdf.pages.some((text) => text.length > 0),
      truncated: pdf.truncated,
    };
  }
  if (kind === "text") {
    const text = new TextDecoder("utf-8").decode(bytes);
    return { text, pages: 1, hasText: text.trim().length > 0, truncated: false };
  }
  if (kind) {
    const office = extractOfficeText(bytes, kind, options);
    const text = office.sections.map((part) => `[${part.label}]\n${part.text}`).join("\n\n");
    return {
      text: office.notes.length ? `${text}\n\n(${office.notes.join(" ")})` : text,
      pages: office.sections.length,
      hasText: office.sections.length > 0,
      truncated: office.notes.length > 0,
    };
  }
  throw new DocumentTextError(unsupportedDocumentMessage(name, mimeType));
}
