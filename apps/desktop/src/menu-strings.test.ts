import { describe, expect, it } from "vitest";
import { menuStrings, withName } from "./menu-strings.js";
import { SETUP_LOCALES } from "./setup-locale.js";

describe("menu strings", () => {
  it("covers every supported language with the same labels as English", () => {
    const keys = Object.keys(menuStrings("en")).sort();
    for (const locale of SETUP_LOCALES) {
      expect(Object.keys(menuStrings(locale)).sort()).toEqual(keys);
    }
  });

  it("speaks Portuguese for pt-BR and fills the product name", () => {
    expect(withName(menuStrings("pt-BR").quit, "Rook")).toBe("Sair do Rook");
    expect(menuStrings("pt-BR").file).toBe("Arquivo");
  });

  it("names the hosted product in each language's own word for the cloud", () => {
    const names = {
      en: "Rook Cloud",
      "pt-BR": "Rook Nuvem",
      es: "Rook Nube",
      fr: "Rook Nuage",
      de: "Rook Cloud",
      ja: "Rook クラウド",
      "zh-CN": "Rook 云",
    } as const;
    for (const locale of SETUP_LOCALES) {
      expect(menuStrings(locale).cloudUnreachable, locale).toContain(names[locale]);
    }
  });
});
