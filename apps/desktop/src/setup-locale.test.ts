import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  matchSetupLocale,
  readSavedLocale,
  SETUP_LOCALES,
  writeSavedLocale,
} from "./setup-locale.js";

describe("matchSetupLocale", () => {
  it("accepts every supported locale as written", () => {
    for (const locale of SETUP_LOCALES) expect(matchSetupLocale(locale)).toBe(locale);
  });

  it("maps system tags to the closest supported locale", () => {
    expect(matchSetupLocale("pt-PT")).toBe("pt-BR");
    expect(matchSetupLocale("pt")).toBe("pt-BR");
    expect(matchSetupLocale("es-MX")).toBe("es");
    expect(matchSetupLocale("ES_AR")).toBe("es");
  });

  it("returns null for an unsupported or empty tag", () => {
    expect(matchSetupLocale("sv-SE")).toBeNull();
    for (const tag of ["sv-SE", "iw", "ko-KR", "ru"]) expect(matchSetupLocale(tag)).toBeNull();
    expect(matchSetupLocale("")).toBeNull();
    expect(matchSetupLocale(undefined)).toBeNull();
    expect(matchSetupLocale("../etc")).toBeNull();
  });
});

describe("saved locale", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });
  async function folder() {
    const dir = await mkdtemp(path.join(tmpdir(), "corvo-locale-"));
    dirs.push(dir);
    return dir;
  }

  it("is null before one was chosen", async () => {
    expect(await readSavedLocale(await folder())).toBeNull();
  });

  it("round-trips the chosen locale", async () => {
    const dir = await folder();
    await writeSavedLocale(dir, "pt-BR");
    expect(await readSavedLocale(dir)).toBe("pt-BR");
  });

  it("ignores a file that holds anything but a supported locale", async () => {
    const dir = await folder();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "locale.json"), '{"locale":"klingon"}');
    expect(await readSavedLocale(dir)).toBeNull();
    await writeFile(path.join(dir, "locale.json"), "not json");
    expect(await readSavedLocale(dir)).toBeNull();
  });
});

describe("first-launch language", () => {
  it("reads a Portuguese system as pt-BR, the language the web app picks too", () => {
    for (const tag of ["pt-BR", "pt-PT", "pt", "pt_BR"])
      expect(matchSetupLocale(tag)).toBe("pt-BR");
    expect(matchSetupLocale("zh-TW")).toBe("zh-CN");
  });
});
