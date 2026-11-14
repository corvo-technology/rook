/** Speech recognizers need regional BCP-47 tags for the app's UI locale codes. */
const SPEECH_LOCALE_TAGS = {
  en: "en-US",
  de: "de-DE",
  es: "es-ES",
  fr: "fr-FR",
  ja: "ja-JP",
  "pt-BR": "pt-BR",
  "zh-CN": "zh-CN",
} as const;

export type SpeechLocale = keyof typeof SPEECH_LOCALE_TAGS;

/** The tag the recognizer needs for a supported UI locale. */
export function speechLocaleTag(locale: SpeechLocale): string {
  return SPEECH_LOCALE_TAGS[locale];
}

const MAX_SPOKEN_LANGUAGES = 5;

/**
 * The languages a person speaks, from the browser or system language list: lowercase base codes
 * (`pt-BR` becomes `pt`), most preferred first, without repeats. Anything that is not a language
 * tag is dropped, so a client cannot smuggle other text into a transcription request.
 */
export function spokenLanguageCodes(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const codes: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const code = tag.trim().split(/[-_]/)[0]?.toLowerCase();
    if (code && /^[a-z]{2,3}$/.test(code) && !codes.includes(code)) codes.push(code);
    if (codes.length === MAX_SPOKEN_LANGUAGES) break;
  }
  return codes;
}
