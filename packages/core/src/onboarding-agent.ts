import type {
  AgentCatalogEntry,
  AppCatalogEntry,
  OnboardingPicks,
  StoreCategory,
} from "@corvo/contracts";
import { AGENT_CATALOG } from "./agent-catalog-data.js";

/** The catalog agent each Store category stands for in onboarding; `personal` is used for personal use. */
export const ONBOARDING_AGENT_BY_CATEGORY: Record<
  StoreCategory,
  { slug: string; personal?: string }
> = {
  finance: { slug: "financial-manager" },
  marketing: { slug: "content-writer" },
  design: { slug: "product-designer" },
  sales: { slug: "sales-prospector" },
  support: { slug: "support-agent" },
  operations: { slug: "project-planner", personal: "daily-briefing" },
  people: { slug: "recruiting-assistant" },
  development: { slug: "bug-triage" },
  knowledge: { slug: "research-analyst" },
};

/** The agent for the first category tapped, or null when none was. Only structured picks are read. */
export function agentForPicks(picks: OnboardingPicks): AgentCatalogEntry | null {
  const category = picks.categories[0];
  if (!category) return null;
  const row = ONBOARDING_AGENT_BY_CATEGORY[category];
  const slug = picks.use === "personal" && row.personal ? row.personal : row.slug;
  return AGENT_CATALOG.find((entry) => entry.slug === slug) ?? null;
}

/** The first app of the agent that signs in with one click and is not connected yet. */
export function oneClickAppFor(
  entry: AgentCatalogEntry,
  apps: readonly AppCatalogEntry[],
  connected: ReadonlySet<string>,
): AppCatalogEntry | null {
  for (const slug of entry.apps) {
    const app = apps.find((candidate) => candidate.slug === slug);
    if (app && app.auth.kind === "oauth" && !connected.has(slug)) return app;
  }
  return null;
}
