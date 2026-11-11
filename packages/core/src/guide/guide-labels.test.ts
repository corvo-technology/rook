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
});
