import type { ConnectorScope, ScopeTool } from "@corvo/core";
import { mcpToolOffered, scopeConnectorForRole } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import type { ExecutorDeps } from "./executor-deps.js";

type Lead = { botId: string; spaceId: string; userId: string };
type Agent = { id: string; name: string; title?: string };

/** One agent's access to a server: the tools it gets, or the whole server at a level. */
export type RoleGrant = {
  allowAllTools: boolean;
  allowedTools: string[];
  level: "read" | "write";
};

export function grantFromScope(scope: ConnectorScope): RoleGrant {
  return scope.kind === "tools"
    ? { allowAllTools: false, allowedTools: scope.allowedTools, level: "write" }
    : { allowAllTools: true, allowedTools: [], level: "read" };
}

/**
 * The access each new agent gets from one server its creator can use, scoped by role and never
 * wider than the creator's own. Without the creator's access, or when the server's tools cannot
 * be listed, an agent gets the server read-only. Undefined when the creator has no access, so the
 * server is not lent at all.
 */
export async function roleGrantsForServer(
  deps: Pick<ExecutorDeps, "mcpServerTools"> & { prisma: PrismaClient },
  lead: Lead,
  serverId: string,
  agents: readonly Agent[],
): Promise<Map<string, RoleGrant> | undefined> {
  const leadGrant = await deps.prisma.botMcpServer.findFirst({
    where: { botId: lead.botId, serverId, spaceId: lead.spaceId, server: { enabled: true } },
    select: { allowAllTools: true, allowedTools: true, level: true },
  });
  if (!leadGrant) return undefined;
  let tools: ScopeTool[] = [];
  if (deps.mcpServerTools) {
    const id = `grant:${serverId}`;
    tools = await deps
      .mcpServerTools(serverId, {
        operationId: id,
        traceId: id,
        spaceId: lead.spaceId,
        userId: lead.userId,
        botId: lead.botId,
        signal: AbortSignal.timeout(30_000),
      })
      .catch(() => []);
  }
  const offered = new Set(
    tools.filter((tool) => mcpToolOffered(leadGrant, tool)).map((tool) => tool.name),
  );
  const result = new Map<string, RoleGrant>();
  for (const agent of agents) {
    const scope = scopeConnectorForRole(agent, tools, offered);
    const grant = grantFromScope(scope);
    // A creator limited to reads never lends more than reads.
    if (leadGrant.allowAllTools && leadGrant.level === "read") grant.level = "read";
    result.set(agent.id, grant);
  }
  return result;
}

/** Lend each server the creator uses to a new agent, by its role. */
export async function grantCreatorServersByRole(
  deps: Pick<ExecutorDeps, "mcpServerTools"> & { prisma: PrismaClient },
  lead: Lead,
  agent: Agent,
): Promise<void> {
  const rows = await deps.prisma.botMcpServer.findMany({
    where: {
      botId: lead.botId,
      spaceId: lead.spaceId,
      userId: lead.userId,
      server: { enabled: true, userId: lead.userId },
    },
    select: { serverId: true },
  });
  for (const { serverId } of rows) {
    const grants = await roleGrantsForServer(deps, lead, serverId, [agent]);
    const grant = grants?.get(agent.id);
    if (!grant) continue;
    await deps.prisma.botMcpServer.upsert({
      where: { botId_serverId: { botId: agent.id, serverId } },
      create: {
        spaceId: lead.spaceId,
        userId: lead.userId,
        botId: agent.id,
        serverId,
        ...grant,
      },
      update: {},
    });
  }
}
