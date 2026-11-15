import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETUP_LOCALES } from "./setup-locale.js";

type Window = {
  SETUP_STRINGS: Record<string, Record<string, string>>;
  SETUP_LANGUAGES: Record<string, string>;
};

function load(): Window {
  const target = {} as Window;
  new Function("window", readFileSync(new URL("./setup-strings.js", import.meta.url), "utf8"))(
    target,
  );
  return target;
}

describe("setup window text", () => {
  const { SETUP_STRINGS, SETUP_LANGUAGES } = load();

  it("covers every supported language", () => {
    expect(Object.keys(SETUP_STRINGS).sort()).toEqual([...SETUP_LOCALES].sort());
    expect(Object.keys(SETUP_LANGUAGES).sort()).toEqual([...SETUP_LOCALES].sort());
  });

  it("has every message in every language, with the address placeholder kept", () => {
    const keys = Object.keys(SETUP_STRINGS.en ?? {});
    for (const locale of SETUP_LOCALES) {
      const messages = SETUP_STRINGS[locale] ?? {};
      expect(Object.keys(messages).sort(), locale).toEqual([...keys].sort());
      for (const key of keys) expect(messages[key]?.trim(), `${locale}.${key}`).not.toBe("");
      expect(messages.answered, locale).toContain("{url}");
    }
  });

  it("names the hosted product in each language's own word for the cloud", () => {
    expect(SETUP_STRINGS["pt-BR"]?.cloud).toBe("Rook Nuvem");
    expect(SETUP_STRINGS.es?.cloud).toBe("Rook Nube");
    expect(SETUP_STRINGS.fr?.cloud).toBe("Rook Nuage");
    expect(SETUP_STRINGS.ja?.cloud).toBe("Rook クラウド");
    expect(SETUP_STRINGS["zh-CN"]?.cloud).toBe("Rook 云");
    expect(SETUP_STRINGS.de?.cloud).toBe("Rook Cloud");
    expect(SETUP_STRINGS.en?.cloud).toBe("Rook Cloud");
  });
});
