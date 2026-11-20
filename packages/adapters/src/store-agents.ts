import type { AgentCatalogEntry, AgentCatalogLocale } from "@corvo/contracts";
import { agentCatalogLocale, agentCatalogSpawnKey } from "@corvo/contracts";
import { AGENT_CATALOG, APP_CATALOG, SKILL_STORE } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { createRepos, runAsSystem } from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { fleetStarterId } from "./child-bots.js";
import type { FleetRun } from "./fleet-tools.js";
import type { ScheduleToolDeps } from "./schedule-tools.js";
import type { StarterRoutineSetup } from "./starter-routines.js";
import {
  createStarterRoutines,
  enqueueRoutineAnnouncement,
  starterRoutinesPrompt,
} from "./starter-routines.js";
import { installStoreSkill } from "./store-skills.js";

const appName = (slug: string) => APP_CATALOG.find((app) => app.slug === slug)?.name ?? slug;

/** Whether the space's organization is a member of a partner: only then are partner agents offered. */
async function spaceHasPartner(prisma: PrismaClient, spaceId: string): Promise<boolean> {
  return runAsSystem("store partner agents", async () => {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { organizationId: true },
    });
    if (!space) return false;
    return (
      (await prisma.partnerMember.count({ where: { organizationId: space.organizationId } })) > 0
    );
  });
}

/** The Store's language for what the model says it is speaking with the owner. */
function languageOf(args: { language?: unknown }) {
  return agentCatalogLocale(typeof args.language === "string" ? args.language : "en");
}

/**
 * The ready-made agents the owner can add, with whether each is already added and which of its
 * apps are connected. Only what the owner sees in the Store: never the agents' instructions.
 */
export async function listStoreAgents(
  deps: { prisma: PrismaClient },
  run: FleetRun,
  args: { language?: unknown },
) {
  const locale = languageOf(args);
  const [bots, servers, partner] = await Promise.all([
    deps.prisma.bot.findMany({
      where: {
        spaceId: run.spaceId,
        userId: fleetStarterId(run),
        archivedAt: null,
        spawnKey: { not: null },
      },
      select: { spawnKey: true },
    }),
    deps.prisma.mcpServer.findMany({
      where: { spaceId: run.spaceId, userId: fleetStarterId(run), enabled: true },
      select: { slug: true },
    }),
    spaceHasPartner(deps.prisma, run.spaceId),
  ]);
  const keys = new Set(bots.map((bot) => bot.spawnKey));
  const connected = new Set(servers.map((server) => server.slug));
  return {
    agents: AGENT_CATALOG.filter((entry) => partner || !entry.partnerAccess).map((entry) => ({
      slug: entry.slug,
      name: entry.name[locale],
      description: entry.description[locale],
      added:
        entry.setup === "email"
          ? [...keys].some((key) => key?.startsWith("email-agent:"))
          : keys.has(agentCatalogSpawnKey(entry.slug)),
      needsSetup: entry.setup === "email",
      apps: entry.apps.map((slug) => ({
        slug,
        name: appName(slug),
        added: connected.has(slug),
      })),
    })),
    note: "Ask the owner before adding one. An agent that needs setup is added by the owner from the Store, under Agents, after connecting an inbox service under Apps.",
  };
}

type StoreDeps = {
  prisma: PrismaClient;
  /** Defaults to the shared bot creation; replaceable so tests need no database. */
  createBot?: ReturnType<typeof createRepos>["createBot"];
};

/**
 * Who may have the agent's starter routines made, and whether the agent tells the person about
 * them. Left out, no routines are made (the owner holds no routine permission, or no model is set).
 */
export type StarterRoutineOptions = { deps: ScheduleToolDeps; announce: boolean };

/**
 * Add a catalog agent for the owner, as the Store's Add button does: the bot in the owner's
 * language, the apps it uses that are already added, and the skills it works best with. Adding
 * twice returns the agent already there.
 */
export async function installStoreAgent(
  deps: StoreDeps,
  run: FleetRun,
  args: { slug?: unknown; language?: unknown },
  starter?: StarterRoutineOptions,
) {
  const entry = AGENT_CATALOG.find((agent) => agent.slug === String(args.slug ?? ""));
  if (!entry) return { error: "No agent with that slug. Call store_agents for the list." };
  const locale = languageOf(args);
  if (entry.partnerAccess && !(await spaceHasPartner(deps.prisma, run.spaceId))) {
    return { error: "No agent with that slug. Call store_agents for the list." };
  }
  if (entry.setup === "email") {
    return {
      error: `${entry.name[locale]} needs an inbox service first. The owner connects MillionSend or Resend under Apps in the Store, then adds it under Agents.`,
    };
  }
  const added = await addStoreAgent(
    deps,
    { spaceId: run.spaceId, userId: fleetStarterId(run) },
    {
      entry,
      locale,
      parentBotId: run.botId,
      // A run is under way, so a model is set; the Chief's grant decides who may make routines.
      ...(starter && run.grants?.manageRoutines ? { starterRoutines: starter } : {}),
    },
  );
  return {
    ok: true as const,
    ...(added.duplicate ? { duplicate: true as const } : {}),
    botId: added.botId,
    name: added.name,
    title: added.title,
    threadId: added.threadId,
    skillsInstalled: added.skillsInstalled,
    appsToConnect: added.appsToConnect,
    ...(added.routines.length
      ? { routinesSetUp: added.routines.map((routine) => routine.name) }
      : {}),
  };
}

/**
 * Create the catalog agent for an owner with no run behind it: no greeting run is queued and no
 * model is called. Adding twice returns the agent already there, flagged as a duplicate.
 */
export async function addStoreAgent(
  deps: StoreDeps,
  owner: { spaceId: string; userId: string },
  input: {
    entry: AgentCatalogEntry;
    locale: AgentCatalogLocale;
    parentBotId?: string;
    starterRoutines?: StarterRoutineOptions;
  },
) {
  const { entry, locale } = input;
  const spawnKey = agentCatalogSpawnKey(entry.slug);
  let duplicate = false;
  let created: { id: string; name: string; title: string; threadId: string | null };
  try {
    const create = deps.createBot ?? createRepos(deps.prisma).createBot;
    created = await create(
      { ...owner, email: "", isDeploymentOwner: false },
      {
        name: entry.name[locale],
        title: "",
        description: entry.description[locale],
        instructions: entry.instructions[locale],
        notifyOnFinish: true,
        color: entry.color,
        // Creation provenance only; the agent stays a peer in the roster.
        ...(input.parentBotId ? { parentBotId: input.parentBotId } : {}),
        spawnKey,
        ...(entry.disabledTools ? { disabledBuiltinTools: [...entry.disabledTools] } : {}),
      },
    );
  } catch (error) {
    const existing = await deps.prisma.bot.findUnique({
      where: { spaceId_spawnKey: { spaceId: owner.spaceId, spawnKey } },
      include: { thread: true },
    });
    if (!existing) throw error;
    duplicate = true;
    created = {
      id: existing.id,
      name: existing.name,
      title: existing.title,
      threadId: existing.thread?.id ?? null,
    };
  }

  const servers = await deps.prisma.mcpServer.findMany({
    where: { ...owner, enabled: true, slug: { in: entry.apps } },
    select: { id: true, slug: true },
  });
  for (const server of servers) {
    await deps.prisma.botMcpServer.upsert({
      where: { botId_serverId: { botId: created.id, serverId: server.id } },
      create: {
        ...owner,
        botId: created.id,
        serverId: server.id,
        allowAllTools: true,
        allowedTools: [],
      },
      update: {},
    });
  }

  const skillsInstalled: string[] = [];
  for (const skill of SKILL_STORE.filter((item) => entry.skills?.includes(item.slug))) {
    const result = await installStoreSkill(deps, owner, skill, locale);
    if ("error" in result)
      getLogger().warn("store agent skill not installed", { skill: skill.slug });
    else if (!result.already) skillsInstalled.push(result.name);
  }

  if (entry.partnerAccess) {
    await deps.prisma.botPartnerGrant.upsert({
      where: { botId: created.id },
      create: { spaceId: owner.spaceId, botId: created.id, level: entry.partnerAccess },
      update: {},
    });
  }

  // Only an agent added now sets up its routines: adding it again, or after the person deleted
  // them, never brings them back.
  let routines: StarterRoutineSetup[] = [];
  if (!duplicate && input.starterRoutines) {
    const { deps: schedule, announce } = input.starterRoutines;
    routines = await createStarterRoutines(schedule, {
      entry,
      locale,
      spaceId: owner.spaceId,
      userId: owner.userId,
      botId: created.id,
      threadId: created.threadId,
      botName: created.name,
    });
    if (announce && routines.length > 0) {
      await enqueueRoutineAnnouncement(
        schedule,
        owner,
        { id: created.id, threadId: created.threadId },
        starterRoutinesPrompt(routines),
      ).catch((error) => getLogger().error("starter routines announcement", error));
    }
  }

  const connected = new Set(servers.map((server) => server.slug));
  return {
    duplicate,
    routines,
    botId: created.id,
    name: created.name,
    title: created.title,
    threadId: created.threadId,
    skillsInstalled,
    appsToConnect: entry.apps.filter((slug) => !connected.has(slug)).map(appName),
  };
}
