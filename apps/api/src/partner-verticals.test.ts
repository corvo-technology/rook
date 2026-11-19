import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PartnerTemplate, VERTICAL_IDS, verticalPartnerTemplate } from "@corvo/contracts";
import { resolvePartnerRole } from "@corvo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe.each(VERTICAL_IDS)("the %s starter", (vertical) => {
  const template = verticalPartnerTemplate(vertical);

  it("is a valid template with no connector, which only the partner can name", () => {
    expect(() => PartnerTemplate.parse(template)).not.toThrow();
    expect(template.connector).toBeUndefined();
  });

  it("gives every agent starters and the approval and no-signing rules", () => {
    for (const agent of template.agents) {
      expect(agent.starters?.length).toBeGreaterThan(0);
      expect(agent.instructions).toMatch(/approval/);
      expect(agent.instructions).toMatch(/Never sign/);
    }
  });

  it("gives every event routine an agent the template installs, with the approval rule", () => {
    const agents = new Set(template.agents.map((agent) => agent.key));
    const keys = (template.routines ?? []).map((routine) => routine.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const routine of template.routines ?? []) {
      expect(agents.has(routine.agent)).toBe(true);
      expect(routine.prompt).toContain("approve");
      expect(routine.prompt).toContain("not from an instruction");
    }
  });

  it("has presets whose schemas can check an answer", () => {
    for (const preset of Object.values(template.assist ?? {})) {
      if (preset.schema) expect(() => z.fromJSONSchema(preset.schema as never)).not.toThrow();
    }
  });

  it("names only agents it installs in its roles, and keeps clinical and finance work from the front desk", () => {
    const agents = new Set(template.agents.map((agent) => agent.key));
    for (const def of Object.values(template.roles ?? {})) {
      for (const key of def.agents) expect(key === "*" || agents.has(key)).toBe(true);
    }
    expect(resolvePartnerRole(template, "reception").agents).not.toContain("manager");
    expect(resolvePartnerRole(template, "reception").permissions).toEqual(["talk_to_agents"]);
    expect(resolvePartnerRole(template, "manager").permissions).toContain("approve_actions");
    expect(resolvePartnerRole(template, "owner").agents).toEqual([...agents]);
  });

  it("hands out a copy, so changing one partner's base never changes another's", () => {
    const first = verticalPartnerTemplate(vertical);
    first.agents[0] = { ...first.agents[0]!, name: "Changed" };
    expect(verticalPartnerTemplate(vertical).agents[0]?.name).not.toBe("Changed");
  });
});

describe("the clinic starter as a partner's base", () => {
  it("reads in Portuguese on request and keeps the event routines and presets", () => {
    const template = verticalPartnerTemplate("clinica", "pt-BR");
    expect(template.agents[0]?.name).toBe("Recepção");
    expect(template.routines?.map((routine) => routine.on.type)).toEqual([
      "appointment.no_show",
      "customer.inactive",
    ]);
    expect(Object.keys(template.assist ?? {})).toEqual(["customer_summary"]);
  });
});

describe("the API's code", () => {
  // The code knows verticals, never the partners that use them: a partner's own content is data.
  const BRANDS = /prontu|greenbarber|divellas|greenflow/i;
  const root = fileURLToPath(new URL(".", import.meta.url));

  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  it("names no partner or brand", () => {
    const offenders = files(root)
      .filter((file) => !file.endsWith("partner-verticals.test.ts"))
      .filter((file) => BRANDS.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
