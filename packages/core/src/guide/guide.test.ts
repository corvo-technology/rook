import { describe, expect, it } from "vitest";
import {
  GUIDE_LANGUAGE_NOTE,
  GUIDE_PAGES,
  guideIndex,
  guideLabels,
  readGuidePage,
} from "./index.js";

const SLUGS = [
  "agents",
  "approvals",
  "board",
  "connectors",
  "getting-started",
  "limits",
  "memory",
  "mobile",
  "models",
  "routines",
  "self-hosting",
  "skills",
  "team",
  "troubleshooting",
  "wiki",
];

describe("guide pages", () => {
  it("has the fifteen pages with unique slugs", () => {
    const slugs = GUIDE_PAGES.map((page) => page.slug);
    expect(slugs).toEqual(SLUGS);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z-]*$/);
  });

  it("gives every page a short title and summary and a bounded body in both languages", () => {
    for (const page of GUIDE_PAGES) {
      for (const locale of ["en", "pt-BR"] as const) {
        const { title, summary, body } = page.text[locale];
        const where = `${page.slug} ${locale}`;
        expect(title.trim(), where).not.toBe("");
        expect(title, where).not.toContain("\n");
        expect(summary.trim(), where).not.toBe("");
        expect(summary, where).not.toContain("\n");
        expect(summary.length, where).toBeLessThanOrEqual(140);
        expect(body.trim().split(/\s+/).length, where).toBeLessThan(600);
      }
    }
  });

  it("indexes each page on one English line", () => {
    const lines = guideIndex().split("\n");
    expect(lines).toHaveLength(GUIDE_PAGES.length);
    GUIDE_PAGES.forEach((page, i) => {
      expect(lines[i]?.startsWith(`- ${page.slug}: `)).toBe(true);
      const pt = page.text["pt-BR"].title;
      if (pt !== page.text.en.title) expect(guideIndex()).not.toContain(pt);
    });
  });
});

describe("readGuidePage", () => {
  it("returns the page in the language asked for, without a note", () => {
    const pt = readGuidePage("Approvals ", "pt-BR");
    expect("page" in pt && pt.page.startsWith("# ")).toBe(true);
    expect("page" in pt && pt.page.includes("Aprovações")).toBe(true);
    expect("page" in pt && pt.page.includes(GUIDE_LANGUAGE_NOTE("English"))).toBe(false);
    const en = readGuidePage("approvals", "en");
    expect("page" in en && en.page.startsWith("# Approvals")).toBe(true);
  });

  it("falls back to English with the note for another or missing language", () => {
    for (const language of ["es", undefined]) {
      const result = readGuidePage("approvals", language);
      expect("page" in result && result.page.startsWith(GUIDE_LANGUAGE_NOTE("English"))).toBe(true);
      expect("page" in result && result.page.includes("# Approvals")).toBe(true);
    }
  });

  it("names the real pages for an unknown slug", () => {
    const result = readGuidePage("nope", "en");
    expect("error" in result).toBe(true);
    for (const slug of SLUGS) expect("error" in result && result.error).toContain(slug);
  });
});

describe("guideLabels", () => {
  it("lists the distinct bold spans, splitting menu paths", () => {
    expect(guideLabels("**Settings** › **Models** and **Apply**")).toEqual([
      "Settings",
      "Models",
      "Apply",
    ]);
    expect(guideLabels("**Apply** then **Apply**")).toEqual(["Apply"]);
  });
});
