import type { Actor } from "@corvo/contracts";
import type { AgentAudience, Speaker, Via } from "@corvo/core";
import { audienceOf, canTalkTo, inAudience } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { IsolationError, loadSpeaker } from "@corvo/db";
import { ORPCError } from "@orpc/server";

type Client = Pick<PrismaClient, "bot" | "spaceMember" | "spaceRole">;

/** The audience of each agent in the space; an agent that is not there is simply absent. */
export async function audiencesOf(
  prisma: Pick<PrismaClient, "bot">,
  spaceId: string,
  botIds: readonly string[],
): Promise<Map<string, AgentAudience>> {
  if (botIds.length === 0) return new Map();
  const rows = await prisma.bot.findMany({
    where: { id: { in: [...botIds] }, spaceId },
    select: {
      id: true,
      userId: true,
      audienceRestricted: true,
      audienceRoleIds: true,
      audienceUserIds: true,
      consultable: true,
    },
  });
  return new Map(rows.map((row) => [row.id, audienceOf(row)]));
}

/** Of these agents, the ones the person may talk to. */
export async function talkableBotIds(
  prisma: Client,
  actor: Pick<Actor, "spaceId" | "userId">,
  botIds: readonly string[],
  via: Via = "person",
  loaded?: Speaker,
): Promise<Set<string>> {
  const audiences = await audiencesOf(prisma, actor.spaceId, botIds);
  // Everyone may talk to an agent that is not restricted, and its owner to any of theirs; only the
  // rest asks who the person is. `talk_to_agents` is the caller's own check.
  const needsSpeaker = [...audiences.values()].some(
    (audience) => audience.restricted && audience.ownerUserId !== actor.userId,
  );
  const speaker = needsSpeaker ? (loaded ?? (await loadSpeaker(prisma, actor))) : undefined;
  return new Set(
    botIds.filter((id) => {
      const audience = audiences.get(id);
      if (!audience) return false;
      if (!audience.restricted || audience.ownerUserId === actor.userId) return true;
      return speaker ? canTalkTo(speaker, audience, via) : false;
    }),
  );
}

/** Refuses a person who may not talk to the agent. Not being in the space is the same refusal. */
export async function requireCanTalkTo(
  prisma: Client,
  actor: Pick<Actor, "spaceId" | "userId">,
  botId: string,
  via: Via = "person",
): Promise<void> {
  if (!(await talkableBotIds(prisma, actor, [botId], via)).has(botId)) {
    throw new ORPCError("FORBIDDEN", { message: "You can't talk to this agent." });
  }
}

/** The conversation of an agent whose audience leaves the person out is not theirs to read. */
export async function requireInAudience(
  prisma: Client,
  actor: Pick<Actor, "spaceId" | "userId">,
  botId: string,
): Promise<void> {
  const audience = (await audiencesOf(prisma, actor.spaceId, [botId])).get(botId);
  if (!audience) throw new IsolationError();
  if (!audience.restricted || audience.ownerUserId === actor.userId) return;
  if (!inAudience(await loadSpeaker(prisma, actor), audience)) throw new IsolationError();
}
