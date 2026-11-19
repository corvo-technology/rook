import type { PartnerTemplate } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { isPartnerOwnerRole, normalizePartnerRole, resolvePartnerRole } from "./partner-roles.js";

const agent = (key: string) => ({ key, name: key, instructions: "", usesConnector: true });

const template: PartnerTemplate = {
  agents: [agent("recepcao"), agent("escriba"), agent("gestor")],
  roles: {
    reception: { agents: ["recepcao"], permissions: ["talk_to_agents"] },
    professional: { agents: ["escriba"], permissions: ["talk_to_agents", "bogus_key"] },
    finance: { agents: ["gestor"], permissions: ["approve_actions", "manage_agents"] },
  },
};

describe("resolvePartnerRole", () => {
  it("treats a missing role, an empty one and owner as the customer's owner", () => {
    for (const role of [undefined, null, "", "  ", "owner", "OWNER"]) {
      const resolved = resolvePartnerRole(template, role);
      expect(resolved.owner).toBe(true);
      expect(resolved.agents).toEqual(["recepcao", "escriba", "gestor"]);
      expect(resolved.hide).toEqual([]);
    }
    expect(isPartnerOwnerRole(undefined)).toBe(true);
    expect(isPartnerOwnerRole("reception")).toBe(false);
    expect(normalizePartnerRole(" Reception ")).toBe("reception");
  });

  it("gives a role the agents and rights the template names, and nothing else", () => {
    const reception = resolvePartnerRole(template, "reception");
    expect(reception.owner).toBe(false);
    expect(reception.agents).toEqual(["recepcao"]);
    expect(reception.permissions).toEqual(["talk_to_agents"]);
    expect(resolvePartnerRole(template, "professional").agents).toEqual(["escriba"]);
  });

  it("drops rights that do not exist and never lets a role talk less than the base", () => {
    expect(resolvePartnerRole(template, "professional").permissions).toEqual(["talk_to_agents"]);
    const finance = resolvePartnerRole(template, "finance");
    expect(finance.permissions).toEqual(["talk_to_agents", "approve_actions", "manage_agents"]);
  });

  it("hides agents, billing and settings from everyone but the owner", () => {
    const hide = resolvePartnerRole(template, "reception").hide;
    expect(hide).toEqual(expect.arrayContaining(["team", "billing", "settings", "routines"]));
    expect(resolvePartnerRole(template, "manager").hide).not.toContain("routines");
    expect(resolvePartnerRole(template, "finance").hide).not.toContain("team");
  });

  it("gives a role the template does not define no agents at all", () => {
    const stranger = resolvePartnerRole(template, "intern");
    expect(stranger.agents).toEqual([]);
    expect(stranger.permissions).toEqual(["talk_to_agents"]);
    expect(resolvePartnerRole(undefined, "reception").agents).toEqual([]);
  });

  it("gives managers every agent unless the template says otherwise", () => {
    expect(resolvePartnerRole(template, "manager").agents).toEqual([
      "recepcao",
      "escriba",
      "gestor",
    ]);
    const narrowed: PartnerTemplate = {
      ...template,
      roles: { manager: { agents: ["gestor"], permissions: [] } },
    };
    expect(resolvePartnerRole(narrowed, "manager").agents).toEqual(["gestor"]);
  });

  it("reads a star as every agent", () => {
    const all: PartnerTemplate = {
      ...template,
      roles: { lead: { agents: ["*"], permissions: [] } },
    };
    expect(resolvePartnerRole(all, "lead").agents).toEqual(["recepcao", "escriba", "gestor"]);
  });
});
