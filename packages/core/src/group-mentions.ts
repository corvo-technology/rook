export type GroupMemberRef = {
  id: string;
  name: string;
};

/** The roster name of a group member bot, when the roster knows it. */
export function memberName(
  members: readonly { botId: string; name: string }[] | undefined,
  botId: string | undefined,
): string | undefined {
  if (!botId || !members) return undefined;
  return members.find((member) => member.botId === botId)?.name;
}

const MENTION_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]{0,39})/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasMentionToken(text: string, name: string): boolean {
  const normalized = name.trim();
  if (!normalized) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_-])@${escapeRegExp(normalized)}(?![\\p{L}\\p{N}_-])`,
    "iu",
  ).test(text);
}

export function parseMentionNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const name = match[1];
    if (name) names.add(name.toLowerCase());
  }
  return [...names];
}

/** Whether a message addresses the whole channel with @everyone. */
export function mentionsEveryone(text: string): boolean {
  return /(?<![\p{L}\p{N}_-])@everyone(?![\p{L}\p{N}_-])/iu.test(text);
}

/** The members a message names: mention chips, @Name and @everyone. Empty when it names nobody. */
export function resolveMentionedBotIds(input: {
  text: string;
  members: GroupMemberRef[];
  /** Bot ids from typed mention chips (non-members are ignored for wake). */
  explicitMentions?: string[];
}): string[] {
  const membersById = new Map(input.members.map((member) => [member.id, member]));
  const targetIds = new Set<string>();

  for (const mentionId of input.explicitMentions ?? []) {
    // Agents outside the channel are woken by `resolveMentionedOutsideBotIds`.
    if (membersById.has(mentionId)) targetIds.add(mentionId);
  }

  const names = ["everyone", ...input.members.map((member) => member.name.trim())]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  // Consume each mention once so a full name cannot also wake its prefix.
  const alternatives = names.map(escapeRegExp).join("|");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])@(${alternatives})(?![\\p{L}\\p{N}_-])`, "giu");
  const mentions = [...input.text.matchAll(pattern)].map((match) => match[1]!);
  const isMentioned = (name: string) => {
    const exactName = new RegExp(`^${escapeRegExp(name.trim())}$`, "iu");
    return mentions.some((mention) => exactName.test(mention));
  };

  if (isMentioned("everyone")) {
    for (const member of input.members) targetIds.add(member.id);
  } else {
    for (const member of input.members) {
      if (isMentioned(member.name)) targetIds.add(member.id);
    }
  }

  return [...targetIds];
}

/**
 * The agents of the space outside the channel that a message names, by mention chip or @Name. A
 * name a member also carries stays with the member, so naming never swaps who answers.
 */
export function resolveMentionedOutsideBotIds(input: {
  text: string;
  members: GroupMemberRef[];
  others: GroupMemberRef[];
  explicitMentions?: string[];
}): string[] {
  const memberIds = new Set(input.members.map((member) => member.id));
  const memberNames = new Set(input.members.map((member) => member.name.trim().toLowerCase()));
  const outside = input.others.filter(
    (bot) => !memberIds.has(bot.id) && !memberNames.has(bot.name.trim().toLowerCase()),
  );
  const outsideIds = new Set(outside.map((bot) => bot.id));
  const targetIds = new Set<string>();
  for (const mentionId of input.explicitMentions ?? []) {
    if (outsideIds.has(mentionId)) targetIds.add(mentionId);
  }
  // Longest first over everyone, so "@Chief of Staff" is not read as "@Chief".
  const names = [...input.members, ...outside]
    .map((bot) => bot.name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [...targetIds];
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_-])@(${names.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
  const mentioned = new Set(
    [...input.text.matchAll(pattern)].map((match) => match[1]!.toLowerCase()),
  );
  for (const bot of outside) {
    if (mentioned.has(bot.name.trim().toLowerCase())) targetIds.add(bot.id);
  }
  return [...targetIds];
}

export function resolveGroupTargetBotIds(input: {
  text: string;
  members: GroupMemberRef[];
  /** Bot ids from typed mention chips; agents outside the channel are woken separately. */
  explicitMentions?: string[];
  /** Who answers a message that addresses nobody: the member the conversation is with. */
  fallbackBotId?: string;
}): string[] {
  const mentioned = resolveMentionedBotIds(input);
  if (mentioned.length > 0) return mentioned;
  const fallback = input.members.find((member) => member.id === input.fallbackBotId);
  const target = fallback ?? input.members[0];
  return target ? [target.id] : [];
}

export function inferHandoffTargetName(prompt: string): string | undefined {
  const handoffMatch =
    /hand(?:\s+this|\s+off|\s+it)?\s+to\s+@?([A-Za-z0-9][A-Za-z0-9_-]{0,39})/i.exec(prompt) ??
    /@([A-Za-z0-9][A-Za-z0-9_-]{0,39})\s+take/i.exec(prompt);
  return handoffMatch?.[1];
}

export function inferHandoffTargetBotId(
  prompt: string,
  members: GroupMemberRef[],
): string | undefined {
  const handedTo = members.find((member) => {
    const escaped = escapeRegExp(member.name.trim());
    return escaped
      ? new RegExp(`\\bto\\s+@?${escaped}(?![\\p{L}\\p{N}_-])`, "iu").test(prompt)
      : false;
  });
  if (handedTo) return handedTo.id;
  const mentioned = members.find((member) => hasMentionToken(prompt, member.name));
  if (mentioned) return mentioned.id;
  const name = inferHandoffTargetName(prompt)?.toLowerCase();
  return name ? members.find((member) => member.name.toLowerCase() === name)?.id : undefined;
}
