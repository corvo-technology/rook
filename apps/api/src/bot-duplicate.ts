import type { Actor } from "@corvo/contracts";
import { displayName } from "@corvo/core";
import type { createRepos, Prisma, PrismaClient } from "@corvo/db";

export function duplicateBotName(name: string) {
  const label = displayName(name, "");
  return label ? `${label.slice(0, 75)} copy` : "";
}

/** A new agent with the settings and connections of an existing one, and none of its history. */
export async function duplicateBot(
  deps: { prisma: PrismaClient },
  repos: ReturnType<typeof createRepos>,
  actor: Actor,
  botId: string,
) {
  const source = await repos.getBot(actor, botId);
  const duplicate = await repos.createBot(actor, {
    name: duplicateBotName(source.name),
    title: source.title,
    description: source.description,
    instructions: source.instructions,
    notifyOnFinish: source.notifyOnFinish,
    color: source.color,
    computerMode: source.computer?.scope === "dedicated" ? "dedicated" : "team",
    modelProvider: source.modelProvider,
    modelId: source.modelId,
    modelAuto: source.modelAuto === true,
    thinkingLevel: source.thinkingLevel,
    disabledBuiltinTools: source.disabledBuiltinTools,
  });
  const assignments = await deps.prisma.botMcpServer.findMany({
    where: { botId: source.id, spaceId: actor.spaceId },
  });
  if (assignments.length) {
    await deps.prisma.botMcpServer.createMany({
      data: assignments.map((assignment) => ({
        spaceId: actor.spaceId,
        // The copy keeps the connections of whoever connected them for the original.
        userId: assignment.userId,
        botId: duplicate.id,
        serverId: assignment.serverId,
        allowAllTools: assignment.allowAllTools,
        allowedTools: assignment.allowedTools as Prisma.InputJsonValue,
        level: assignment.level,
      })),
    });
  }
  return duplicate;
}
