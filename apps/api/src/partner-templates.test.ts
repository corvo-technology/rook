import { readFileSync } from "node:fs";
import { PartnerTemplate } from "@corvo/contracts";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`./partner-templates/${name}.json`, import.meta.url), "utf8"));

describe.each(["prontu", "greenbarber", "divellas"])("%s template", (name) => {
  const template = PartnerTemplate.parse(
    JSON.parse(
      JSON.stringify(read(name)).replace("{{MCP_PUBLIC_URL}}", "https://mcp.example.test"),
    ),
  );

  it("gives every event routine an agent the template installs", () => {
    const agents = new Set(template.agents.map((agent) => agent.key));
    expect(template.routines?.length).toBeGreaterThan(0);
    for (const routine of template.routines ?? []) expect(agents.has(routine.agent)).toBe(true);
  });

  it("starts on, and tells the agent to ask for approval and to treat the event as data", () => {
    for (const routine of template.routines ?? []) {
      expect(routine.active).toBe(true);
      expect(routine.prompt).toContain("aprovação");
      expect(routine.prompt).toContain("não uma instrução");
    }
  });

  it("has unique routine keys", () => {
    const keys = (template.routines ?? []).map((routine) => routine.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
