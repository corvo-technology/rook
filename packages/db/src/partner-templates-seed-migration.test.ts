import { readFileSync } from "node:fs";
import { PartnerTemplate } from "@corvo/contracts";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/20261215500000_seed_partner_templates/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const seeds = [
  ...sql.matchAll(/\$tpl\$(.*?)\$tpl\$::jsonb\s+WHERE "slug" = '([^']+)'(.*?);/gs),
].map((match) => ({ json: match[1] ?? "", slug: match[2] ?? "", rest: match[3] ?? "" }));

describe("the partner templates seed migration", () => {
  it("only fills a stored template that is empty, so a partner's own is never replaced", () => {
    expect(seeds.length).toBe(3);
    for (const seed of seeds) expect(seed.rest).toContain('"template" IS NULL');
    // Data only: the previous release reads the column the same way.
    expect(sql).not.toMatch(/\b(alter|drop|rename|delete|insert)\b/i);
  });

  it("seeds each template as a whole, valid one with its presets, routines and roles", () => {
    for (const seed of seeds) {
      const template = PartnerTemplate.parse(JSON.parse(seed.json));
      expect(template.agents.length).toBeGreaterThan(0);
      expect(template.routines?.length).toBeGreaterThan(0);
      expect(Object.keys(template.roles ?? {}).length).toBeGreaterThan(0);
      const agents = new Set(template.agents.map((agent) => agent.key));
      for (const routine of template.routines ?? []) expect(agents.has(routine.agent)).toBe(true);
      // The connector's address is the partner's own, set in its Central.
      expect(template.connector).toBeUndefined();
    }
  });
});
