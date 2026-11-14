import { spokenLanguageCodes } from "@corvo/core";

/**
 * The languages the person speaks, from the phone's language list rather than the app's own: an
 * app shown in English on a Portuguese phone must still listen for Portuguese. Empty when the
 * list cannot be read, which leaves detection to the server.
 */
export async function spokenLanguages(): Promise<string[]> {
  try {
    // Lazy like i18n: modules evaluated without native modules must still load.
    const localization = await import("expo-localization");
    return spokenLanguageCodes(localization.getLocales().map((locale) => locale.languageTag));
  } catch {
    return [];
  }
}
