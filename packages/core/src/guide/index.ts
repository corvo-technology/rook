import { GUIDE_PAGES } from "./pages.js";
import type { GuideLocale, GuidePage } from "./types.js";

export { GUIDE_PAGES } from "./pages.js";
export type { GuideLocale, GuidePage, GuideText } from "./types.js";

/** One line per page, `- <slug>: <title>. <summary>`, in English: the only part that rides in instructions. */
export function guideIndex(pages: readonly GuidePage[] = GUIDE_PAGES): string {
  return pages
    .map((page) => `- ${page.slug}: ${page.text.en.title}. ${page.text.en.summary}`)
    .join("\n");
}

export const GUIDE_LANGUAGE_NOTE = (language: string): string =>
  `This page is in ${language}. Answer in the language the person is writing in, and do not copy the page's labels verbatim; name what the person will see on their screen.`;

const LANGUAGE_NAMES: Record<GuideLocale, string> = { en: "English", "pt-BR": "Portuguese" };

function isGuideLocale(value: unknown): value is GuideLocale {
  return value === "en" || value === "pt-BR";
}

/**
 * One page in the language asked for when it exists, else English with a note telling the model
 * to answer in the person's language. An unknown slug lists the real ones; nothing throws.
 */
export function readGuidePage(
  slug: unknown,
  language: unknown,
  pages: readonly GuidePage[] = GUIDE_PAGES,
): { page: string } | { error: string } {
  const key = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  const found = pages.find((page) => page.slug === key);
  if (!found) return { error: `No such page. Pages: ${pages.map((p) => p.slug).join(", ")}.` };
  const locale: GuideLocale = isGuideLocale(language) ? language : "en";
  const { title, body } = found.text[locale];
  const text = `# ${title}\n\n${body}`;
  return {
    page: locale === language ? text : `${GUIDE_LANGUAGE_NOTE(LANGUAGE_NAMES[locale])}\n\n${text}`,
  };
}

/** The distinct UI labels a page body names: every `**…**` span, with menu paths split on " › ". */
export function guideLabels(body: string): string[] {
  const labels = new Set<string>();
  for (const match of body.matchAll(/\*\*([^*\n]+)\*\*/g)) {
    for (const part of (match[1] ?? "").split(" › ")) labels.add(part.trim());
  }
  return [...labels];
}
