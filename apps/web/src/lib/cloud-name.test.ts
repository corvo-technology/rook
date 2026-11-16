import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../locales/", import.meta.url);
const locales = readdirSync(fileURLToPath(root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "en")
  .map((entry) => entry.name);

/** German writes "Cloud" itself; the other languages have their own word for it. */
const KEEPS_CLOUD = new Set(["de"]);
/** A vendor's product, not ours. */
const VENDOR_NAMES = /Ollama Cloud/g;

function translations(locale: string): string[] {
  const text = readFileSync(fileURLToPath(new URL(`${locale}/messages.po`, root)), "utf8");
  return [...text.matchAll(/^msgstr ((?:".*"\n?)+)/gm)].map((match) =>
    (match[1]?.match(/"(?:[^"\\]|\\.)*"/g) ?? [])
      .map((part) => JSON.parse(part) as string)
      .join(""),
  );
}

describe("the hosted product's name in each language", () => {
  it("uses each language's own word for the cloud, never the English one", () => {
    for (const locale of locales.filter((name) => !KEEPS_CLOUD.has(name))) {
      const english = translations(locale)
        .map((text) => text.replace(VENDOR_NAMES, ""))
        .filter((text) => /\bcloud\b/i.test(text));
      expect(english, locale).toEqual([]);
    }
  });

  it("never names the product Rook Cloud outside English and German", () => {
    for (const locale of locales.filter((name) => !KEEPS_CLOUD.has(name))) {
      expect(
        translations(locale).filter((text) => text.includes("Rook Cloud")),
        locale,
      ).toEqual([]);
    }
  });
});
