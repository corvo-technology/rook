import { AGENT_CATALOG, SKILL_STORE } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { addStoreAgent, installStoreAgent, listStoreAgents } from "./store-agents.js";

const run = {
  spaceId: "space-1",
  userId: "user-1",
  botId: "chief-1",
  groupId: null,
  threadId: "thread-1",
  runId: "run-1",
};

type Row = Record<string, unknown>;

function fixture(
  over: { bots?: Row[]; servers?: Row[]; skills?: Row[]; createBot?: () => Promise<Row> } = {},
) {
  const created: Row[] = [];
  const assigned: Row[] = [];
  const skillsCreated: Row[] = [];
  const prisma = {
    bot: {
      findMany: vi.fn(async () => over.bots ?? []),
      findUnique: vi.fn(async () => ({
        id: "existing-bot",
        name: "Existing",
        title: "",
        thread: { id: "t-9" },
      })),
    },
    mcpServer: { findMany: vi.fn(async () => over.servers ?? []) },
    botMcpServer: {
      upsert: vi.fn(async ({ create }: { create: Row }) => {
        assigned.push(create);
        return create;
      }),
    },
    agentSkill: {
      findMany: vi.fn(async () => over.skills ?? []),
      create: vi.fn(async ({ data }: { data: Row }) => {
        skillsCreated.push(data);
        return { id: `skill-${skillsCreated.length}`, ...data };
      }),
      findFirst: vi.fn(async () => null),
    },
  } as unknown as PrismaClient;
  const createBot = vi.fn(async (_actor: unknown, input: Row) => {
    if (over.createBot) return over.createBot();
    created.push(input);
    return { id: "new-bot", name: input.name, title: "", threadId: "t-1" };
  });
  return { prisma, createBot, created, assigned, skillsCreated };
}

describe("listStoreAgents", () => {
  it("lists every agent in the language asked for, with what each needs", async () => {
    const f = fixture();
    const result = await listStoreAgents({ prisma: f.prisma }, run, { language: "pt-BR" });
    expect(result.agents).toHaveLength(AGENT_CATALOG.length);
    const financial = result.agents.find((agent) => agent.slug === "financial-manager");
    expect(financial).toMatchObject({
      name: "Fluxo de caixa",
      added: false,
      apps: [{ slug: "stripe", name: "Stripe", added: false }],
    });
  });

  it("uses English unless Portuguese is asked for", async () => {
    const f = fixture();
    const result = await listStoreAgents({ prisma: f.prisma }, run, {});
    expect(result.agents.find((agent) => agent.slug === "translator")?.name).toBe("Translator");
  });

  it("marks the agents already added, and the apps already connected", async () => {
    const f = fixture({
      bots: [{ spawnKey: "agent-catalog:financial-manager" }, { spawnKey: "email-agent:user-1" }],
      servers: [{ slug: "stripe" }],
    });
    const result = await listStoreAgents({ prisma: f.prisma }, run, {});
    const financial = result.agents.find((agent) => agent.slug === "financial-manager");
    expect(financial?.added).toBe(true);
    expect(financial?.apps).toEqual([{ slug: "stripe", name: "Stripe", added: true }]);
    expect(result.agents.find((agent) => agent.slug === "email-agent")?.added).toBe(true);
    expect(result.agents.find((agent) => agent.slug === "translator")?.added).toBe(false);
  });

  it("flags the agent that needs an inbox service instead of a plain install", async () => {
    const f = fixture();
    const result = await listStoreAgents({ prisma: f.prisma }, run, {});
    expect(result.agents.find((agent) => agent.slug === "email-agent")?.needsSetup).toBe(true);
    expect(result.agents.find((agent) => agent.slug === "translator")?.needsSetup).toBe(false);
  });

  it("never returns the agents' private instructions", async () => {
    const f = fixture();
    const result = await listStoreAgents({ prisma: f.prisma }, run, {});
    expect(JSON.stringify(result)).not.toContain("How you work");
  });
});

describe("installStoreAgent", () => {
  const install = (f: ReturnType<typeof fixture>, args: Record<string, unknown>) =>
    installStoreAgent({ prisma: f.prisma, createBot: f.createBot as never }, run, args);

  it("creates the agent from the catalog in the language asked, keyed so the Store sees it as added", async () => {
    const f = fixture();
    const entry = AGENT_CATALOG.find((agent) => agent.slug === "translator")!;
    const result = await install(f, { slug: "translator", language: "pt-BR" });
    expect(result).toMatchObject({ ok: true, botId: "new-bot", name: entry.name["pt-BR"] });
    expect(f.created[0]).toMatchObject({
      name: entry.name["pt-BR"],
      description: entry.description["pt-BR"],
      instructions: entry.instructions["pt-BR"],
      color: entry.color,
      spawnKey: "agent-catalog:translator",
      parentBotId: "chief-1",
    });
  });

  it("turns off the tools that are another agent's job", async () => {
    const f = fixture();
    const entry = AGENT_CATALOG.find((agent) => agent.slug === "social-media-manager")!;
    await install(f, { slug: "social-media-manager" });
    expect(f.created[0]).toMatchObject({ disabledBuiltinTools: entry.disabledTools });
    const g = fixture();
    await install(g, { slug: "translator" });
    expect(g.created[0]).not.toHaveProperty("disabledBuiltinTools");
  });

  it("refuses an agent that is not in the catalog and says how to see the list", async () => {
    const f = fixture();
    const result = await install(f, { slug: "no-such-agent" });
    expect(result).toHaveProperty("error");
    expect(String((result as { error: string }).error)).toContain("store_agents");
    expect(f.createBot).not.toHaveBeenCalled();
  });

  it("does not install the agent that needs an inbox service, and says what the owner does", async () => {
    const f = fixture();
    const result = await install(f, { slug: "email-agent" });
    expect(result).toHaveProperty("error");
    expect(f.createBot).not.toHaveBeenCalled();
  });

  it("gives the agent the apps it uses that the owner already added, and names the ones still missing", async () => {
    const f = fixture({ servers: [{ id: "srv-sentry", slug: "sentry" }] });
    const result = (await install(f, { slug: "bug-triage" })) as {
      appsToConnect: string[];
    };
    expect(f.assigned.map((row) => row.serverId)).toEqual(["srv-sentry"]);
    expect(result.appsToConnect).toEqual(["Linear"]);
  });

  it("installs the skills the agent works best with, once", async () => {
    const f = fixture({
      skills: [{ id: "s0", name: "Bug Report", description: "d", content: "c", source: "user" }],
    });
    const entry = AGENT_CATALOG.find((agent) => agent.slug === "bug-triage")!;
    expect(entry.skills).toContain("bug-report");
    const result = (await install(f, { slug: "bug-triage", language: "en" })) as {
      skillsInstalled: string[];
    };
    // The one the owner already has is left alone.
    expect(f.skillsCreated.map((row) => row.name)).not.toContain("Bug Report");
    expect(result.skillsInstalled).toEqual(f.skillsCreated.map((row) => row.name));
    void SKILL_STORE;
  });

  it("returns the agent already added instead of making a second one", async () => {
    const f = fixture({
      createBot: async () => {
        throw new Error("duplicate spawn key");
      },
    });
    const result = await install(f, { slug: "translator" });
    expect(result).toMatchObject({ ok: true, duplicate: true, botId: "existing-bot" });
  });
});

describe("addStoreAgent", () => {
  const owner = { spaceId: "space-1", userId: "user-1" };
  const entry = AGENT_CATALOG.find((agent) => agent.slug === "research-analyst")!;

  it("adds an agent for an owner without a run, with no parent", async () => {
    const f = fixture();
    const result = await addStoreAgent(
      { prisma: f.prisma, createBot: f.createBot as never },
      owner,
      { entry, locale: "en" },
    );
    expect(result).toMatchObject({ botId: "new-bot", duplicate: false });
    expect(f.created[0]).toMatchObject({ spawnKey: "agent-catalog:research-analyst" });
    expect(f.created[0]).not.toHaveProperty("parentBotId");
  });

  it("reports a repeat add as a duplicate of the same bot", async () => {
    const f = fixture({
      createBot: async () => {
        throw new Error("duplicate spawn key");
      },
    });
    const result = await addStoreAgent(
      { prisma: f.prisma, createBot: f.createBot as never },
      owner,
      { entry, locale: "en" },
    );
    expect(result).toMatchObject({ duplicate: true, botId: "existing-bot" });
  });
});
