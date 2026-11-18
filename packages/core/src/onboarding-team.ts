import type { BusinessKind, StoreCategory, WorkArea } from "@corvo/contracts";
import { ONBOARDING_AGENT_BY_CATEGORY } from "./onboarding-agent.js";

/** What each kind of business usually needs, most important first. */
const CATEGORIES_BY_BUSINESS: Record<BusinessKind, readonly StoreCategory[]> = {
  agency: ["marketing", "operations", "sales"],
  "online-store": ["sales", "support", "operations"],
  clinic: ["support", "operations", "finance"],
  software: ["development", "support", "operations"],
  "customer-service": ["support", "knowledge", "operations"],
  "services-office": ["finance", "sales", "operations"],
  other: ["knowledge", "operations"],
};

/** The Store category an area of work stands for; "other" names none. */
const CATEGORY_BY_AREA: Record<WorkArea, StoreCategory | null> = {
  development: "development",
  marketing: "marketing",
  sales: "sales",
  finance: "finance",
  operations: "operations",
  support: "support",
  other: null,
};

export const SUGGESTED_TEAM_MAX_AGENTS = 4;
export const SUGGESTED_TEAM_MAX_CHANNELS = 3;

export type SuggestedAgent = { slug: string; category: StoreCategory };

/**
 * The agents Rook suggests beside the Chief: what the person looks after first, then what the
 * kind of business usually needs. Deterministic, so the same answers give the same team.
 */
export function suggestTeam(input: {
  business: BusinessKind | null;
  areas: readonly WorkArea[];
}): SuggestedAgent[] {
  const categories: StoreCategory[] = [];
  const add = (category: StoreCategory | null | undefined) => {
    if (category && !categories.includes(category)) categories.push(category);
  };
  for (const area of input.areas) add(CATEGORY_BY_AREA[area]);
  for (const category of input.business ? CATEGORIES_BY_BUSINESS[input.business] : [])
    add(category);
  return categories
    .slice(0, SUGGESTED_TEAM_MAX_AGENTS)
    .map((category) => ({ slug: ONBOARDING_AGENT_BY_CATEGORY[category].slug, category }));
}

/** The channels that go with a team: one per agent, for the first few. */
export function suggestedChannelAgents(
  agents: readonly SuggestedAgent[],
): readonly SuggestedAgent[] {
  return agents.slice(0, SUGGESTED_TEAM_MAX_CHANNELS);
}

/** What is true of a space right now, as far as the Home checklist cares. */
export type HomeChecklistFacts = {
  invited: boolean;
  connected: boolean;
  hasRoutine: boolean;
  talked: boolean;
};

/** The checklist items in the order they show. */
export function homeChecklist(facts: HomeChecklistFacts): {
  items: { id: "talk" | "connect" | "routine" | "invite"; done: boolean }[];
  done: number;
  total: number;
} | null {
  const items = [
    { id: "talk" as const, done: facts.talked },
    { id: "connect" as const, done: facts.connected },
    { id: "routine" as const, done: facts.hasRoutine },
    { id: "invite" as const, done: facts.invited },
  ];
  const done = items.filter((item) => item.done).length;
  return done === items.length ? null : { items, done, total: items.length };
}
