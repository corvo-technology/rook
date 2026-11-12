import { describe, expect, it } from "vitest";
import {
  documentCuratorInstructions,
  documentParts,
  mergeImportOps,
  pdfSections,
  textSections,
} from "./wiki-import.js";

describe("documentParts", () => {
  it("groups pages into parts named by the pages they hold", () => {
    const pages = ["a".repeat(60), "b".repeat(60), "c".repeat(60)];
    const { parts, truncated } = documentParts(pdfSections(pages), { size: 100 });
    expect(parts.map((part) => part.label)).toEqual(["p. 1", "p. 2", "p. 3"]);
    expect(truncated).toBe(false);
    const grouped = documentParts(pdfSections(pages), { size: 130 });
    expect(grouped.parts.map((part) => part.label)).toEqual(["p. 1-2", "p. 3"]);
    expect(grouped.parts[0]!.text).toContain("[p. 1]\n");
    expect(grouped.parts[0]!.text).toContain("[p. 2]\n");
  });

  it("skips a page with no text and keeps the page numbers of the rest", () => {
    const { parts } = documentParts(pdfSections(["first", "  ", "third"]));
    expect(parts).toHaveLength(1);
    expect(parts[0]!.label).toBe("p. 1-3");
    expect(parts[0]!.text).not.toContain("[p. 2]");
  });

  it("cuts a long page and a long text file, and leaves out parts past the limit", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${"x".repeat(30)}`).join(
      "\n\n",
    );
    const { parts } = documentParts(pdfSections([long]), { size: 300 });
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((part) => part.label === "p. 1")).toBe(true);
    expect(parts.every((part) => part.text.length <= 300 + 20)).toBe(true);
    const text = documentParts(textSections(long), { size: 300, maxParts: 2 });
    expect(text.parts).toHaveLength(2);
    expect(text.truncated).toBe(true);
  });
});

describe("mergeImportOps", () => {
  it("adds to a page an earlier part created instead of creating it twice", () => {
    const merged = mergeImportOps([
      [{ op: "create", page: "Alpha", body: "One." }],
      [
        { op: "create", page: "alpha", body: "Two." },
        { op: "replace", page: "Alpha", old: "One.", new: "Uno." },
        { op: "append", page: "Beta", text: "Three." },
      ],
    ]);
    expect(merged).toEqual([
      { op: "create", page: "Alpha", body: "One." },
      { op: "append", page: "alpha", text: "Two." },
      { op: "append", page: "Beta", text: "Three." },
    ]);
  });
});

describe("documentCuratorInstructions", () => {
  it("names the file and the form of a citation", () => {
    const text = documentCuratorInstructions("Policy.pdf");
    expect(text).toContain("(Source: Policy.pdf, p. N)");
  });
});
