import type { SecretStore } from "@corvo/adapter-kit";
import { buildMcpCredentialBlob } from "@corvo/adapters";
import type { Actor, CreateBotInput, PartnerEventRoutine } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { computerContext } from "./routes/shared.js";

export interface PartnerContent {
  /** The partner's own system, as an MCP server this customer's agents can use. */
  connector?: { slug: string; name: string; endpoint: string; token: string };
  agents: Array<{
    key: string;
    name: string;
    instructions: string;
    usesConnector: boolean;
    starters?: string[];
  }>;
  /** Routines started by the partner's events; each runs on one of `agents`. */
  routines?: PartnerEventRoutine[];
}

export interface PartnerContentDeps {
  prisma: PrismaClient;
  secrets: SecretStore;
  /** Throws when the endpoint is not one this deployment may call. */
  assertEndpoint(endpoint: string): Promise<void>;
  /** Idempotent by spawn key: the same key in a space returns the same bot, untouched. */
  createBot(actor: Actor, input: CreateBotInput): Promise<{ id: string }>;
}

/**
 * Gives one partner customer its connector and its starter agents, the way the email agent gets
 * its inbox. Safe to repeat: the connector is made once and only its token and address follow the
 * latest call; an agent is made once and never changed afterwards, so what the customer edited
 * stays. No agent runs: bots are made without their first run.
 */
export async function installPartnerTenantContent(
  deps: PartnerContentDeps,
  actor: Actor,
  partnerId: string,
  content: PartnerContent,
): Promise<{ botIds: Record<string, string> }> {
  const { connector } = content;
  if (connector) await deps.assertEndpoint(connector.endpoint);

  let serverId: string | null = null;
  if (connector) {
    // The token goes only to the sealed secret store; the server row records header names, not values.
    const blob = buildMcpCredentialBlob({
      headers: { Authorization: `Bearer ${connector.token}` },
    });
    const sealed = await deps.secrets.put(
      blob as string,
      computerContext(actor, "mcp", "partner.install"),
    );
    serverId = await deps.prisma.$transaction(async (tx) => {
      await tx.secret.create({
        data: {
          id: sealed.id,
          userId: actor.userId,
          spaceId: actor.spaceId,
          kind: "mcp",
          ciphertext: sealed.ciphertext,
        },
      });
      const existing = await tx.mcpServer.findFirst({
        where: { spaceId: actor.spaceId, userId: actor.userId, slug: connector.slug },
        select: { id: true, secretId: true },
      });
      if (!existing) {
        const created = await tx.mcpServer.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            slug: connector.slug,
            name: connector.name,
            description: "",
            transport: "streamable_http",
            endpoint: connector.endpoint,
            headers: { Authorization: true },
            secretId: sealed.id,
            enabled: true,
          },
        });
        return created.id;
      }
      const previousSecretId = existing.secretId;
      await tx.mcpServer.update({
        where: { id: existing.id },
        data: {
          endpoint: connector.endpoint,
          headers: { Authorization: true },
          secretId: sealed.id,
          enabled: true,
        },
      });
      if (previousSecretId) {
        await tx.secret.deleteMany({
          where: { id: previousSecretId, spaceId: actor.spaceId, userId: actor.userId },
        });
      }
      return existing.id;
    });
  }

  const botIds: Record<string, string> = {};
  for (const agent of content.agents) {
    const bot = await deps.createBot(actor, {
      name: agent.name,
      title: "",
      description: "",
      instructions: agent.instructions,
      notifyOnFinish: true,
      computerMode: "team",
      ...(agent.starters?.length ? { starters: agent.starters } : {}),
      spawnKey: `partner:${partnerId}:${agent.key}`,
      intro: false,
    });
    botIds[agent.key] = bot.id;
    if (serverId && agent.usesConnector) {
      await deps.prisma.botMcpServer.upsert({
        where: { botId_serverId: { botId: bot.id, serverId } },
        create: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: bot.id,
          serverId,
          allowAllTools: true,
          allowedTools: [],
        },
        update: {},
      });
    }
  }
  // Made once and never changed: a customer who switched one off keeps it off.
  for (const routine of content.routines ?? []) {
    const botId = botIds[routine.agent];
    if (!botId) continue;
    await deps.prisma.routine.upsert({
      where: { botId_templateKey: { botId, templateKey: routine.key } },
      create: {
        spaceId: actor.spaceId,
        botId,
        userId: actor.userId,
        name: routine.name,
        prompt: routine.prompt,
        crons: [],
        active: routine.active,
        notify: true,
        eventTrigger: routine.on,
        templateKey: routine.key,
      },
      update: {},
    });
  }
  return { botIds };
}
