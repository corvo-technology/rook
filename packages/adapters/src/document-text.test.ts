import { describe, expect, it } from "vitest";
import { makePdf } from "./document-fixtures.test-support.js";
import {
  DocumentTextError,
  documentKind,
  extractPdfText,
  readableDocumentText,
} from "./document-text.js";

describe("extractPdfText", () => {
  it("reads the text of each page, in order", async () => {
    const result = await extractPdfText(
      makePdf(["First page about Alpha.", "Second page about Beta."]),
    );
    expect(result.pages).toEqual(["First page about Alpha.", "Second page about Beta."]);
    expect(result.totalPages).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("reads only the first pages of a very long document and says so", async () => {
    const result = await extractPdfText(makePdf(["One.", "Two.", "Three."]), { maxPages: 2 });
    expect(result.pages).toEqual(["One.", "Two."]);
    expect(result.totalPages).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("gives an empty page for a page that has no text, as a scan has", async () => {
    const result = await extractPdfText(makePdf(["Has text.", ""]));
    expect(result.pages).toEqual(["Has text.", ""]);
  });

  it("refuses a file that is not a PDF, with a message a person can act on", async () => {
    await expect(extractPdfText(new TextEncoder().encode("just some text"))).rejects.toThrow(
      DocumentTextError,
    );
    await expect(extractPdfText(new TextEncoder().encode("just some text"))).rejects.toThrow(
      /not a readable PDF/i,
    );
  });

  it("stops when the request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      extractPdfText(makePdf(["Text."]), { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe("documentKind", () => {
  it("tells a PDF by its type or its name, and plain text by its type", () => {
    expect(documentKind("report.pdf", "application/pdf")).toBe("pdf");
    expect(documentKind("report.PDF", "application/octet-stream")).toBe("pdf");
    expect(documentKind("notes.txt", "text/plain")).toBe("text");
    expect(documentKind("data.csv", "text/csv")).toBe("text");
    expect(documentKind("page.html", "text/html")).toBe("text");
    expect(documentKind("clip.mp4", "video/mp4")).toBeUndefined();
    expect(documentKind("archive.zip", "application/zip")).toBeUndefined();
  });
});

describe("readableDocumentText", () => {
  it("puts a marker before each page so a quote can name its page", async () => {
    const text = await readableDocumentText(
      makePdf(["Alpha.", "Beta."]),
      "report.pdf",
      "application/pdf",
    );
    expect(text.text).toBe("[page 1]\nAlpha.\n\n[page 2]\nBeta.");
    expect(text.pages).toBe(2);
    expect(text.hasText).toBe(true);
  });

  it("says when a PDF has no text to read, as with a scanned document", async () => {
    const text = await readableDocumentText(makePdf(["", ""]), "scan.pdf", "application/pdf");
    expect(text.hasText).toBe(false);
  });

  it("decodes a plain text file as it is", async () => {
    const text = await readableDocumentText(
      new TextEncoder().encode("Line one.\nLine two."),
      "notes.txt",
      "text/plain",
    );
    expect(text.text).toBe("Line one.\nLine two.");
    expect(text.pages).toBe(1);
  });

  it("refuses a kind of file it cannot read", async () => {
    await expect(
      readableDocumentText(new Uint8Array([1, 2, 3]), "clip.mp4", "video/mp4"),
    ).rejects.toThrow(/can read PDF, Word/i);
  });
});
