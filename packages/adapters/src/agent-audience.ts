import { audienceOf, canTalkTo } from "@corvo/core";
import type { PrismaClient } from "@corvo/db";
import { loadSpeaker } from "@corvo/db";

type AudienceBot = {
  userId: string;
  audienceRestricted: boolean;
  audienceRoleIds: string[];
  audienceUserIds: string[];
  consultable: boolean;
};

/**
 * Whether the person behind a run (a routine's creator, whoever started a member's run) may talk
 * to the agent. The same rule as every other entry point: `canTalkTo`. An agent that is not
 * restricted, and its own owner, need no lookup.
 */
export async function personMayTalkTo(
  prisma: Pick<PrismaClient, "spaceMember" | "spaceRole">,
  person: { spaceId: string; userId: string },
  bot: AudienceBot,
  via: "person" | "agent" = "person",
): Promise<boolean> {
  if (!bot.audienceRestricted || bot.userId === person.userId) return true;
  return canTalkTo(await loadSpeaker(prisma, person), audienceOf(bot), via);
}

/** The columns `personMayTalkTo` reads. */
export const audienceSelect = {
  userId: true,
  audienceRestricted: true,
  audienceRoleIds: true,
  audienceUserIds: true,
  consultable: true,
} as const;
