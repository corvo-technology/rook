import type { AgentCatalogLocale } from "@corvo/contracts";

export type GuideLocale = AgentCatalogLocale;

/** One page in one language. UI labels the page names are written **Label**, as the screen shows them. */
export type GuideText = { title: string; summary: string; body: string };

export type GuidePage = { slug: string; text: Record<GuideLocale, GuideText> };
