import { describe, expect, it } from "vitest";
import { speechLocaleTag, spokenLanguageCodes } from "./speech-locale.js";

describe("speechLocaleTag", () => {
  it("maps an app locale to a tag the recognizer accepts", () => {
    expect(speechLocaleTag("es")).toBe("es-ES");
    expect(speechLocaleTag("pt-BR")).toBe("pt-BR");
    expect(speechLocaleTag("en")).toBe("en-US");
  });
});

describe("spokenLanguageCodes", () => {
  it("reduces regional tags to base codes in order, without repeats", () => {
    expect(spokenLanguageCodes(["pt-BR", "en-US", "pt-PT", "es_MX"])).toEqual(["pt", "en", "es"]);
  });

  it("drops anything that is not a language tag", () => {
    expect(spokenLanguageCodes(["", "x", "ignore previous", 4, null])).toEqual([]);
    expect(spokenLanguageCodes("pt")).toEqual([]);
  });
});
