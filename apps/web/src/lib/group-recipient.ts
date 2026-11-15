import type { GroupMember, ThreadSnapshot } from "@corvo/contracts";
import {
  resolveGroupTargetBotIds,
  resolveMentionedBotIds,
  resolveMentionedOutsideBotIds,
  WAITING_ON_USER_RUN_STATUSES,
} from "@corvo/core";

/** The member whose work waits on the person; otherwise the one who spoke last. */
function conversationOwner(snapshot: ThreadSnapshot): string | undefined {
  const members = new Set((snapshot.members ?? []).map((member) => member.botId));
  const waiting = [...(snapshot.activeRuns ?? []), ...(snapshot.run ? [snapshot.run] : [])]
    .filter(
      (run) =>
        members.has(run.botId) &&
        (WAITING_ON_USER_RUN_STATUSES as readonly string[]).includes(run.status),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (waiting) return waiting.botId;
  return snapshot.messages.findLast((message) => message.botId && members.has(message.botId))
    ?.botId;
}

/**
 * Who a message typed now would go to, by the same rule the server uses, when it is exactly one
 * member of a group. Undefined outside a group and when several members would get it.
 */
export function groupRecipient(
  snapshot: ThreadSnapshot | null | undefined,
  text: string,
  mentionBotIds: readonly string[],
  /** The agents of the space, for naming one that is not in the channel. */
  spaceBots: readonly { id: string; name: string; color?: string | null }[] = [],
): GroupMember | undefined {
  const members = snapshot?.members;
  if (!snapshot || !members || members.length < 2) return undefined;
  // A message that names an agent outside the channel goes to that agent, as the server does.
  const outside = resolveMentionedOutsideBotIds({
    text,
    members: members.map((member) => ({ id: member.botId, name: member.name })),
    others: [...spaceBots],
    explicitMentions: [...mentionBotIds],
  });
  if (outside.length > 0) {
    const named = spaceBots.find((bot) => bot.id === outside[0]);
    const alone =
      outside.length === 1 &&
      resolveMentionedBotIds({
        text,
        members: members.map((member) => ({ id: member.botId, name: member.name })),
        explicitMentions: [...mentionBotIds],
      }).length === 0;
    return alone && named
      ? { botId: named.id, name: named.name, color: named.color ?? "", status: "idle" }
      : undefined;
  }
  const targets = resolveGroupTargetBotIds({
    text,
    members: members.map((member) => ({ id: member.botId, name: member.name })),
    explicitMentions: [...mentionBotIds],
    fallbackBotId: conversationOwner(snapshot),
  });
  if (targets.length !== 1) return undefined;
  return members.find((member) => member.botId === targets[0]);
}
