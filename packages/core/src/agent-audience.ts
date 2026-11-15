import type { SpaceMembership } from "./space-permissions.js";
import { can } from "./space-permissions.js";

/** Who may talk to an agent. Unrestricted is everyone in the space, as agents always were. */
export interface AgentAudience {
  /** The agent's owner: always may. */
  ownerUserId: string;
  restricted: boolean;
  roleIds: readonly string[];
  userIds: readonly string[];
  /** Another agent may consult it for someone outside the audience. */
  consultable: boolean;
}

/** A person as the audience rule reads them. */
export interface Speaker {
  userId: string;
  roleIds: readonly string[];
  /** Resolved keys, as `can` reads them. */
  membership: Pick<SpaceMembership, "isOwner" | "permissions"> | null;
}

export function speakerOf(
  userId: string,
  membership:
    | (Pick<SpaceMembership, "isOwner" | "permissions"> & { roleIds?: readonly string[] })
    | null,
): Speaker {
  return { userId, roleIds: membership?.roleIds ?? [], membership };
}

/**
 * Whether the person is in the agent's audience: its owner, or anyone while it is unrestricted, or
 * the people and role holders it names. Reading its conversation asks only this.
 */
export function inAudience(speaker: Speaker, audience: AgentAudience): boolean {
  if (!speaker.membership) return false;
  if (!audience.restricted || speaker.userId === audience.ownerUserId) return true;
  return (
    audience.userIds.includes(speaker.userId) ||
    speaker.roleIds.some((roleId) => audience.roleIds.includes(roleId))
  );
}

/** Which agent is asking on someone's behalf, when one is. */
export type Via = "person" | "agent";

/**
 * The one rule for "may this person talk to this agent": DMs, mentions, the channel router,
 * routines and runs a member starts all ask it. Its owner always may; anyone else needs
 * `talk_to_agents` first, then everyone
 * qualifies unless the agent is restricted, in which case its owner, the people named and the
 * holders of a named role do. An agent acting for someone (`via: "agent"`) may also reach an agent
 * that takes consultations, outside its audience, though never past `talk_to_agents`.
 */
export function canTalkTo(speaker: Speaker, audience: AgentAudience, via: Via = "person"): boolean {
  if (!speaker.membership) return false;
  if (speaker.userId === audience.ownerUserId) return true;
  if (!can(speaker.membership, "talk_to_agents")) return false;
  return inAudience(speaker, audience) || (via === "agent" && audience.consultable);
}

/** The audience columns of a bot row. */
export function audienceOf(bot: {
  userId: string;
  audienceRestricted: boolean;
  audienceRoleIds: readonly string[];
  audienceUserIds: readonly string[];
  consultable: boolean;
}): AgentAudience {
  return {
    ownerUserId: bot.userId,
    restricted: bot.audienceRestricted,
    roleIds: bot.audienceRoleIds,
    userIds: bot.audienceUserIds,
    consultable: bot.consultable,
  };
}
