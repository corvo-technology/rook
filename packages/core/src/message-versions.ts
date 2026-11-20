import type { MessageBlock } from "@corvo/contracts";

type VersionedMessage = {
  id: string;
  role: string;
  blocks: readonly MessageBlock[];
  authorUserId?: string;
  callId?: string;
};

const isLiveId = (id: string) => id.startsWith("progress:") || id.startsWith("subagent:");

/** The person's own text message, while a new version can still be made of it. */
export function canEditMessage(
  message: VersionedMessage,
  viewerUserId: string | undefined,
): boolean {
  return (
    message.role === "user" &&
    !isLiveId(message.id) &&
    !message.callId &&
    message.blocks.length > 0 &&
    message.blocks.every((block) => block.kind === "text") &&
    (message.authorUserId ?? viewerUserId) === viewerUserId
  );
}

/** A message a new chat can be carried on from: words someone said, not a live status. */
export function canBranchFromMessage(message: VersionedMessage): boolean {
  return (
    (message.role === "user" || message.role === "bot") &&
    !isLiveId(message.id) &&
    message.blocks.some((block) => block.kind === "text")
  );
}

/** The agent's newest reply, when nothing of the person's came after it; only that one is redone. */
export function lastReplyId(messages: readonly VersionedMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || isLiveId(message.id) || message.role === "system") continue;
    return message.role === "bot" && message.blocks.some((block) => block.kind === "text")
      ? message.id
      : undefined;
  }
  return undefined;
}
