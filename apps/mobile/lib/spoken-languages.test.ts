import { describe, expect, it, vi } from "vitest";

const locales = vi.hoisted(() => ({ getLocales: vi.fn() }));
vi.mock("expo-localization", () => locales);

import { spokenLanguages } from "./spoken-languages";

describe("spokenLanguages", () => {
  it("lists the phone's languages as base codes", async () => {
    locales.getLocales.mockReturnValue([{ languageTag: "pt-BR" }, { languageTag: "en-US" }]);
    await expect(spokenLanguages()).resolves.toEqual(["pt", "en"]);
  });

  it("is empty when the phone cannot say", async () => {
    locales.getLocales.mockImplementation(() => {
      throw new Error("no native module");
    });
    await expect(spokenLanguages()).resolves.toEqual([]);
  });
});
