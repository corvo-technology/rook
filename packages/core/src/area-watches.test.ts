import {
  AreaWatchSchema,
  agentCatalogSpawnKey,
  VERTICAL_TEMPLATES,
  verticalSpawnKey,
} from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./agent-catalog-data.js";
import { AREA_WATCHES, areaWatchesFor } from "./area-watches.js";

describe("AREA_WATCHES", () => {
  it("only names agents that exist, with valid, unique watches", () => {
    const known = new Set([
      ...AGENT_CATALOG.map((entry) => agentCatalogSpawnKey(entry.slug)),
      ...VERTICAL_TEMPLATES.flatMap((template) =>
        template.agents.map((agent) => verticalSpawnKey(template.id, agent.key)),
      ),
    ]);
    for (const [spawnKey, watches] of Object.entries(AREA_WATCHES)) {
      expect(known.has(spawnKey), spawnKey).toBe(true);
      for (const watch of watches) expect(() => AreaWatchSchema.parse(watch)).not.toThrow();
      expect(new Set(watches.map((watch) => watch.key)).size).toBe(watches.length);
    }
  });

  it("gives the clinic's reception a calendar watch and nothing to an unknown agent", () => {
    expect(areaWatchesFor(verticalSpawnKey("clinica", "reception")).map((w) => w.preset)).toEqual([
      "calendar",
    ]);
    expect(areaWatchesFor("agent-catalog:nope")).toEqual([]);
    expect(areaWatchesFor(null)).toEqual([]);
  });
});
