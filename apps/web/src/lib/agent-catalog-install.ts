import type { AgentCatalogEntry, AgentCatalogLocale, McpServer } from "@corvo/contracts";
import { agentCatalogSpawnKey } from "@corvo/contracts";
import { AGENT_CATALOG, SKILL_STORE } from "@corvo/core";
import { rpc } from "./rpc";
import { installStoreSkill, isSkillInstalled } from "./skill-store-install";

/** The catalog agent a bot was made from, found by its creation key. */
export function catalogAgentOf(bot: { spawnKey?: string | null }): AgentCatalogEntry | undefined {
  return bot.spawnKey
    ? AGENT_CATALOG.find((entry) => agentCatalogSpawnKey(entry.slug) === bot.spawnKey)
    : undefined;
}

/** The servers of `entry`'s apps that are already added and, when they sign in, signed in. */
export function connectedServersFor(
  entry: AgentCatalogEntry,
  servers: readonly McpServer[],
): McpServer[] {
  return servers.filter(
    (server) =>
      entry.apps.includes(server.slug) &&
      server.enabled &&
      (server.oauthStatus === "none" || server.oauthStatus === "connected"),
  );
}

/**
 * Install the store skills an agent works best with, leaving out the ones already installed. A
 * skill that cannot be installed (for example, the person already has one by that name) never
 * stops the agent from being added.
 */
async function installAgentSkills(
  entry: AgentCatalogEntry,
  locale: AgentCatalogLocale,
  installedSkillNames: readonly string[],
): Promise<void> {
  const wanted = SKILL_STORE.filter(
    (skill) => entry.skills?.includes(skill.slug) && !isSkillInstalled(skill, installedSkillNames),
  );
  await Promise.allSettled(wanted.map((skill) => installStoreSkill(skill, locale)));
}

/**
 * Add a catalog agent: a bot with its instructions in the person's language and the apps it
 * works with that are already connected, plus the skills it works best with. Adding again returns
 * the same bot.
 */
export async function addCatalogAgent(
  entry: AgentCatalogEntry,
  locale: AgentCatalogLocale,
  servers: readonly McpServer[],
  installedSkillNames: readonly string[] = [],
): Promise<{ botId: string }> {
  if (entry.setup === "email") {
    const service = connectedServersFor(entry, servers)[0];
    if (!service) throw new Error("Connect an inbox service first");
    const { botId } = await rpc.emailAgent.install({ serverId: service.id, locale });
    await installAgentSkills(entry, locale, installedSkillNames);
    await rpc.threads.send({
      botId,
      text: entry.greeting?.[locale] ?? entry.name[locale],
      clientNonce: crypto.randomUUID(),
    });
    return { botId };
  }
  const bot = await rpc.bots.create({
    name: entry.name[locale],
    title: "",
    description: entry.description[locale],
    instructions: entry.instructions[locale],
    color: entry.color,
    notifyOnFinish: true,
    computerMode: "team",
    spawnKey: agentCatalogSpawnKey(entry.slug),
    ...(entry.disabledTools ? { disabledBuiltinTools: entry.disabledTools } : {}),
  });
  await installAgentSkills(entry, locale, installedSkillNames);
  const connected = connectedServersFor(entry, servers);
  if (connected.length > 0) {
    await rpc.mcp.assignments.replace({
      botId: bot.id,
      assignments: connected.map((server) => ({
        serverId: server.id,
        allowAllTools: true,
        allowedTools: [],
      })),
    });
  }
  return { botId: bot.id };
}
