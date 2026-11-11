import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUIDE_PAGES, guideLabels } from "./index.js";

/** Reads the msgid/msgstr pairs of a gettext catalog, skipping the header entry. */
function parsePo(path: string): Map<string, string> {
  const pairs = new Map<string, string>();
  let field: "msgid" | "msgstr" | null = null;
  let id = "";
  let str = "";
  const flush = () => {
    if (id !== "") pairs.set(id, str);
    id = "";
    str = "";
  };
  const unquote = (raw: string) => JSON.parse(raw.trim()) as string;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("msgid ")) {
      flush();
      field = "msgid";
      id = unquote(line.slice(6));
    } else if (line.startsWith("msgstr ")) {
      field = "msgstr";
      str = unquote(line.slice(7));
    } else if (line.startsWith('"') && field) {
      if (field === "msgid") id += unquote(line);
      else str += unquote(line);
    }
  }
  flush();
  return pairs;
}

const root = process.cwd();

/** The mobile catalog is a plain object literal in a TypeScript file outside this package. */
function readMobileMessages(path: string): Record<string, string> {
  const source = readFileSync(path, "utf8");
  const literal = source.slice(source.indexOf("= {") + 2, source.lastIndexOf("}") + 1);
  return new Function(`return ${literal}`)() as Record<string, string>;
}
const PT_BR_MESSAGES = readMobileMessages(join(root, "apps/mobile/lib/locales/pt-BR.ts"));
const web = parsePo(join(root, "apps/web/src/locales/pt-BR/messages.po"));
const webIds = new Set(web.keys());
const webTranslations = new Set(web.values());
const mobileIds = new Set(Object.keys(PT_BR_MESSAGES));
const mobileTranslations = new Set(Object.values(PT_BR_MESSAGES));

describe("guide labels", () => {
  it("reads the catalogs", () => {
    expect(web.get("Approvals")).toBe("Aprovações");
    expect(PT_BR_MESSAGES.Approvals).toBe("Aprovações");
  });

  it("names only labels the app shows", () => {
    const missing: string[] = [];
    for (const page of GUIDE_PAGES) {
      for (const label of guideLabels(page.text.en.body)) {
        if (!webIds.has(label) && !mobileIds.has(label)) missing.push(`${page.slug} en: ${label}`);
      }
      for (const label of guideLabels(page.text["pt-BR"].body)) {
        if (!webTranslations.has(label) && !mobileTranslations.has(label)) {
          missing.push(`${page.slug} pt-BR: ${label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("names in Portuguese what the English page names, label for label", () => {
    // Every pt-BR label must be the catalog translation of the English label at the same place,
    // on the surface (web or mobile) that has the English label.
    const wrong: string[] = [];
    for (const page of GUIDE_PAGES) {
      const en = guideLabels(page.text.en.body);
      const pt = guideLabels(page.text["pt-BR"].body);
      if (en.length !== pt.length) {
        wrong.push(`${page.slug}: ${en.length} English labels, ${pt.length} Portuguese`);
        continue;
      }
      en.forEach((label, index) => {
        const accepted = [web.get(label), PT_BR_MESSAGES[label]].filter(Boolean);
        if (!accepted.includes(pt[index])) wrong.push(`${page.slug}: ${label} -> ${pt[index]}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it("keeps the same sections in both languages", () => {
    const headings = (body: string) => body.match(/^## /gm)?.length ?? 0;
    for (const page of GUIDE_PAGES) {
      expect(headings(page.text["pt-BR"].body), page.slug).toBe(headings(page.text.en.body));
    }
  });

  it("points only to pages that exist", () => {
    const slugs = new Set(GUIDE_PAGES.map((page) => page.slug));
    const unknown: string[] = [];
    for (const page of GUIDE_PAGES) {
      for (const match of page.text.en.body.matchAll(
        /the ([a-z-]+)(?: and ([a-z-]+))? pages?\b/g,
      )) {
        for (const slug of [match[1], match[2]]) {
          if (slug && !slugs.has(slug)) unknown.push(`${page.slug}: ${slug}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
