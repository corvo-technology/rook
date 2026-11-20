import type { MessageBlock } from "@corvo/contracts";

/**
 * Several person messages answered in one turn: the agent starts each answer with its own marker
 * line, and the reply is split into one message per question.
 */
const MARKER = /\[\[reply:([A-Za-z0-9_-]+)\]\]\n?/g;

export function replyMarker(messageId: string): string {
  return `[[reply:${messageId}]]`;
}

export interface ReplyPart {
  /** The person message this part answers. */
  replyToMessageId: string;
  blocks: MessageBlock[];
}

/** Drops reply markers from text meant for people. */
export function stripReplyMarkers(text: string): string {
  return text.replace(MARKER, "");
}

/** Splits streamed text into what is safe to show and an unfinished marker to wait on. */
export function holdBackPartialMarker(text: string): { emit: string; hold: string } {
  const clean = stripReplyMarkers(text);
  const open = clean.lastIndexOf("[[");
  if (open < 0 || clean.indexOf("]]", open) >= 0) {
    return clean.endsWith("[")
      ? { emit: clean.slice(0, -1), hold: "[" }
      : { emit: clean, hold: "" };
  }
  return { emit: clean.slice(0, open), hold: clean.slice(open) };
}

function hasText(blocks: readonly MessageBlock[]): boolean {
  return blocks.some((block) => block.kind === "text" && block.text.trim() !== "");
}

/**
 * Splits a reply across the person messages it answers, in the order the markers appear.
 * Text before the first marker goes to the first message. Without a usable marker the whole
 * reply answers the last message. Targets are in the order the messages were sent.
 */
export function splitReplyByMessage(
  blocks: readonly MessageBlock[],
  targets: readonly string[],
): ReplyPart[] {
  const last = targets.at(-1);
  if (!last) return [];
  const known = new Set(targets);
  const parts: Array<{ id: string | undefined; blocks: MessageBlock[] }> = [];
  let current: { id: string | undefined; blocks: MessageBlock[] } = { id: undefined, blocks: [] };
  let marked = false;
  const push = (text: string) => {
    const clean = stripReplyMarkers(text).trim();
    if (clean) current.blocks.push({ kind: "text", text: clean });
  };
  const open = (id: string) => {
    marked = true;
    if (current.id === id) return;
    if (current.id === undefined && !hasText(current.blocks)) {
      current.id = id;
      return;
    }
    parts.push(current);
    current = { id, blocks: [] };
  };
  for (const block of blocks) {
    if (block.kind !== "text") {
      current.blocks.push(block);
      continue;
    }
    let cursor = 0;
    for (const match of block.text.matchAll(MARKER)) {
      const id = match[1] ?? "";
      if (!known.has(id)) continue;
      push(block.text.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      open(id);
    }
    push(block.text.slice(cursor));
  }
  parts.push(current);
  const first = targets[0] as string;
  return parts
    .filter((part) => part.blocks.length > 0)
    .map((part) => ({
      replyToMessageId: part.id ?? (marked ? first : last),
      blocks: part.blocks,
    }));
}
