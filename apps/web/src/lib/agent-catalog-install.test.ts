import { AGENT_CATALOG } from "@corvo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCatalogAgent, catalogAgentOf, connectedServersFor } from "./agent-catalog-install";

const create = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const emailInstall = vi.hoisted(() => vi.fn());
const send = vi.hoisted(() => vi.fn());
const createSkill = vi.hoisted(() => vi.fn());

vi.mock("./rpc", () => ({
  rpc: {
    bots: { create },
    mcp: { assignments: { replace } },
    emailAgent: { install: emailInstall },
    threads: { send },
    agentSkills: { create: createSkill },
  },
}));

const agent = (slug: string) => AGENT_CATALOG.find((entry) => entry.slug === slug)!;
const server = (slug: string, over: Record<string, unknown> = {}) =>
  ({ id: `srv-${slug}`, slug, enabled: true, oauthStatus: "connected", ...over }) as never;

beforeEach(() => {
  create.mockReset().mockResolvedValue({ id: "bot-1" });
  replace.mockReset().mockResolvedValue([]);
  emailInstall.mockReset().mockResolvedValue({ botId: "bot-2" });
  send.mockReset().mockResolvedValue({});
  createSkill.mockReset().mockResolvedValue({});
});

describe("connectedServersFor", () => {
  it("keeps the agent's apps that are enabled and signed in", () => {
    const entry = agent("bug-triage");
    const servers = [
      server("sentry"),
      server("linear", { oauthStatus: "reconnect" }),
      server("notion"),
      server("sentry", { id: "other", enabled: false }),
    ];
    expect(connectedServersFor(entry, servers).map((s) => s.id)).toEqual(["srv-sentry"]);
  });
});

describe("addCatalogAgent", () => {
  it("creates the bot with its text in the person's language and a key that marks it added", async () => {
    const entry = agent("research-analyst");
    await expect(addCatalogAgent(entry, "pt-BR", [])).resolves.toEqual({ botId: "bot-1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: entry.name["pt-BR"],
        description: entry.description["pt-BR"],
        instructions: entry.instructions["pt-BR"],
        color: entry.color,
        spawnKey: "agent-catalog:research-analyst",
      }),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("turns off the tools that are another agent's job", async () => {
    const entry = agent("social-media-manager");
    await addCatalogAgent(entry, "en", []);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ disabledBuiltinTools: entry.disabledTools }),
    );
  });

  it("leaves the tools alone for an agent that turns none off", async () => {
    await addCatalogAgent(agent("research-analyst"), "en", []);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("disabledBuiltinTools");
  });

  it("uses English for every language but Portuguese", async () => {
    const entry = agent("research-analyst");
    await addCatalogAgent(entry, "en", []);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: entry.name.en, instructions: entry.instructions.en }),
    );
  });

  it("gives the bot only the apps that are already connected", async () => {
    await addCatalogAgent(agent("bug-triage"), "en", [server("sentry"), server("notion")]);
    expect(replace).toHaveBeenCalledWith({
      botId: "bot-1",
      assignments: [{ serverId: "srv-sentry", allowAllTools: true, allowedTools: [] }],
    });
  });

  it("installs the email agent with a connected inbox service and sends its greeting", async () => {
    await expect(
      addCatalogAgent(agent("email-agent"), "pt-BR", [server("millionsend")]),
    ).resolves.toEqual({ botId: "bot-2" });
    expect(emailInstall).toHaveBeenCalledWith({ serverId: "srv-millionsend", locale: "pt-BR" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "bot-2", text: "Configure sua caixa de entrada." }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("does not install the email agent before an inbox service is connected", async () => {
    await expect(addCatalogAgent(agent("email-agent"), "en", [])).rejects.toThrow();
    expect(emailInstall).not.toHaveBeenCalled();
  });
});

describe("an agent's skills", () => {
  const withSkills = { ...agent("research-analyst"), skills: ["project-plan", "email-reply"] };

  it("installs the skills the agent works best with, in the person's language", async () => {
    await addCatalogAgent(withSkills, "pt-BR", []);
    expect(createSkill.mock.calls.map(([skill]) => skill.name).sort()).toEqual([
      "Plano de projeto",
      "Resposta de email",
    ]);
  });

  it("leaves out the skills already installed, in either language", async () => {
    await addCatalogAgent(withSkills, "en", [], ["Plano de projeto"]);
    expect(createSkill.mock.calls.map(([skill]) => skill.name)).toEqual(["Email Reply"]);
  });

  it("still adds the agent when a skill cannot be installed", async () => {
    createSkill.mockRejectedValue(new Error("A skill with that name already exists"));
    await expect(addCatalogAgent(withSkills, "en", [])).resolves.toEqual({ botId: "bot-1" });
    expect(create).toHaveBeenCalled();
  });

  it("installs skills for the email agent too", async () => {
    const email = { ...agent("email-agent"), skills: ["email-reply"] };
    await addCatalogAgent(email, "en", [server("millionsend")]);
    expect(createSkill).toHaveBeenCalledWith(expect.objectContaining({ name: "Email Reply" }));
  });

  it("does nothing for an agent without skills", async () => {
    await addCatalogAgent(agent("translator"), "en", []);
    expect(createSkill).not.toHaveBeenCalled();
  });
});

describe("catalogAgentOf", () => {
  it("finds the catalog agent a bot was made from", () => {
    expect(catalogAgentOf({ spawnKey: "agent-catalog:bug-triage" })?.slug).toBe("bug-triage");
  });

  it("finds none for a bot made by hand", () => {
    expect(catalogAgentOf({ spawnKey: null })).toBeUndefined();
    expect(catalogAgentOf({ spawnKey: "onboarding:first" })).toBeUndefined();
    expect(catalogAgentOf({})).toBeUndefined();
  });
});
