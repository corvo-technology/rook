import type { Locale } from "../locales";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import ja from "./ja";
import pt from "./pt";
import type { PartnersCopy } from "./types";
import zh from "./zh";

export type { PartnersCopy } from "./types";

const COPY: Record<Locale, PartnersCopy> = { en, pt, es, fr, de, ja, zh };

export function getPartnersCopy(locale: Locale): PartnersCopy {
  return COPY[locale];
}

/** Each language's partners page, for the footer and the language alternates. */
export function partnersPath(locale: Locale): string {
  return `${COPY[locale].path}/`;
}
