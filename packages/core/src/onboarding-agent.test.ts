import type { AgentCatalogEntry } from "@corvo/contracts";
import { STORE_CATEGORIES } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./agent-catalog-data.js";
import { APP_CATALOG } from "./app-catalog-data.js";
import { agentForPicks, ONBOARDING_AGENT_BY_CATEGORY, oneClickAppFor } from "./onboarding-agent.js";

const bySlug = (slug: string) => AGENT_CATALOG.find((entry) => entry.slug === slug);

describe("onboarding agents", () => {
  it("every category has an agent that is in the catalog, in that category, needs no setup and has a first task", () => {
    for (const category of STORE_CATEGORIES) {
      const row = ONBOARDING_AGENT_BY_CATEGORY[category];
      for (const slug of [row.slug, row.personal]) {
        if (!slug) continue;
        const entry = bySlug(slug);
        expect(entry, slug).toBeDefined();
        expect(entry?.category).toBe(category);
        expect(entry?.setup).toBeUndefined();
        expect(entry?.firstTask).toBeDefined();
      }
    }
  });

  it("the first picked category decides", () => {
    expect(agentForPicks({ categories: ["sales", "finance"] })?.slug).toBe("sales-prospector");
  });

  it("personal use picks the personal agent where one exists", () => {
    expect(agentForPicks({ use: "personal", categories: ["operations"] })?.slug).toBe(
      "daily-briefing",
    );
    expect(agentForPicks({ use: "work", categories: ["operations"] })?.slug).toBe(
      "project-planner",
    );
    expect(agentForPicks({ use: "both", categories: ["operations"] })?.slug).toBe(
      "project-planner",
    );
    expect(agentForPicks({ use: "personal", categories: ["sales"] })?.slug).toBe(
      "sales-prospector",
    );
  });

  it("no category gives no agent", () => {
    expect(agentForPicks({ categories: [] })).toBeNull();
    expect(agentForPicks({ use: "work", categories: [] })).toBeNull();
  });

  it("offers only an app that signs in with one click", () => {
    const entry = bySlug("bug-triage") as AgentCatalogEntry;
    expect(entry.apps).toEqual(["sentry", "linear"]);
    expect(oneClickAppFor(entry, APP_CATALOG, new Set())?.slug).toBe("sentry");
    expect(oneClickAppFor(entry, APP_CATALOG, new Set(["sentry"]))?.slug).toBe("linear");
    expect(oneClickAppFor(entry, APP_CATALOG, new Set(["sentry", "linear"]))).toBeNull();
    const keyed = { ...entry, apps: ["posthog"] };
    expect(APP_CATALOG.find((app) => app.slug === "posthog")?.auth.kind).not.toBe("oauth");
    expect(oneClickAppFor(keyed, APP_CATALOG, new Set())).toBeNull();
    expect(
      oneClickAppFor(
        entry,
        APP_CATALOG.filter((app) => app.slug !== "sentry" && app.slug !== "linear"),
        new Set(),
      ),
    ).toBeNull();
  });
});
