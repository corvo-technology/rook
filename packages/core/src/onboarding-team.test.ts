import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./agent-catalog-data.js";
import {
  homeChecklist,
  SUGGESTED_TEAM_MAX_AGENTS,
  suggestedChannelAgents,
  suggestTeam,
} from "./onboarding-team.js";

describe("suggestTeam", () => {
  it("puts what the person looks after before what the business needs", () => {
    const team = suggestTeam({ business: "agency", areas: ["finance"] });
    expect(team.map((agent) => agent.category)).toEqual([
      "finance",
      "marketing",
      "operations",
      "sales",
    ]);
  });

  it("is the same every time for the same answers", () => {
    const input = { business: "software", areas: ["support", "development"] } as const;
    expect(suggestTeam(input)).toEqual(suggestTeam(input));
  });

  it("never repeats an agent and never goes past the cap", () => {
    const team = suggestTeam({
      business: "online-store",
      areas: ["sales", "support", "operations", "marketing", "finance", "development"],
    });
    expect(team).toHaveLength(SUGGESTED_TEAM_MAX_AGENTS);
    expect(new Set(team.map((agent) => agent.slug)).size).toBe(team.length);
  });

  it("ignores 'other' and falls back to the business alone", () => {
    expect(suggestTeam({ business: "clinic", areas: ["other"] }).map((a) => a.category)).toEqual([
      "support",
      "operations",
      "finance",
    ]);
  });

  it("suggests nothing without answers", () => {
    expect(suggestTeam({ business: null, areas: [] })).toEqual([]);
  });

  it("only suggests agents that exist in the catalog and need no setup", () => {
    for (const business of ["agency", "online-store", "clinic", "software", "other"] as const) {
      for (const agent of suggestTeam({ business, areas: ["development", "sales"] })) {
        const entry = AGENT_CATALOG.find((candidate) => candidate.slug === agent.slug);
        expect(entry?.setup).toBeUndefined();
        expect(entry?.category).toBe(agent.category);
      }
    }
  });

  it("makes a channel for the first agents only", () => {
    const team = suggestTeam({ business: "agency", areas: ["sales", "finance", "marketing"] });
    expect(suggestedChannelAgents(team)).toEqual(team.slice(0, 3));
  });
});

describe("homeChecklist", () => {
  const none = { invited: false, connected: false, hasRoutine: false, talked: false };

  it("lists the items in order with what is done", () => {
    expect(homeChecklist({ ...none, connected: true })).toEqual({
      items: [
        { id: "talk", done: false },
        { id: "connect", done: true },
        { id: "routine", done: false },
        { id: "invite", done: false },
      ],
      done: 1,
      total: 4,
    });
  });

  it("is gone once everything is done", () => {
    expect(homeChecklist({ invited: true, connected: true, hasRoutine: true, talked: true })).toBe(
      null,
    );
  });
});
