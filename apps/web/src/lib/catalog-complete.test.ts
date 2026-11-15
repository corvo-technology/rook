import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../locales/", import.meta.url);
const locales = readdirSync(fileURLToPath(root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "en")
  .map((entry) => entry.name);

/** Every message in a locale catalog that has no translation yet. */
function untranslated(locale: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`${locale}/messages.po`, root)), "utf8");
  const missing: string[] = [];
  for (const block of text.split("\n\n")) {
    if (block.includes("#~")) continue;
    const read = (key: string) => {
      const match = new RegExp(`^${key} ((?:".*"\\n?)+)`, "m").exec(block);
      return (match?.[1]?.match(/"(?:[^"\\]|\\.)*"/g) ?? [])
        .map((part) => JSON.parse(part) as string)
        .join("");
    };
    const id = read("msgid");
    if (id && !read("msgstr").trim()) missing.push(id);
  }
  return missing;
}

describe("translation catalogs", () => {
  it("lists the locales it checks", () => {
    expect(locales).toContain("pt-BR");
  });

  // Run `pnpm --filter @corvo/web intl:extract` after adding a string, then translate each locale.
  it.each(locales)("%s has no message left untranslated", (locale) => {
    expect(untranslated(locale)).toEqual([]);
  });
});
