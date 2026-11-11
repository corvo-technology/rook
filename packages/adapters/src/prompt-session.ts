import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import { EMPTY_LIVE_CONTEXT } from "./run-instructions.js";

export interface ShownMessage {
  id: string;
  hash: string;
}

export interface LiveBlock {
  /** The history message this block sits right before. */
  beforeId: string;
  text: string;
}

export type FreshReason =
  | "new"
  | "busy"
  | "setup"
  | "missing"
  | "edited"
  | "inserted"
  | "failed"
  | "expired"
  | "stale-live";

export type PromptSessionPlan =
  | { resume: false; reason: FreshReason; owner: boolean }
  | { resume: true; replay: LiveBlock[]; sendLive: "changed" | "emptied" | false; owner: true };

/** Superseded live blocks above this size (estimated tokens) cost more than a fresh start. */
export const MAX_STALE_LIVE_TOKENS = 16_384;
const DEFAULT_MAX_ENTRIES = 256;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** What the model sees of a stored message: its rendered text and its images. */
export function shownMessage(message: {
  id: string;
  content: string;
  images?: ReadonlyArray<{ name?: string; mimeType?: string; data?: Uint8Array }>;
}): ShownMessage {
  const images = (message.images ?? []).map((image) => [
    image.name ?? "",
    image.mimeType ?? "",
    image.data ? createHash("sha256").update(image.data).digest("hex") : "",
  ]);
  return { id: message.id, hash: sha256(JSON.stringify([message.content, images])) };
}

export function promptSessionKey(parts: {
  spaceId?: string;
  userId?: string;
  botId: string;
  threadId: string;
  provider: string;
  connectionId?: string;
  baseUrl?: string;
  modelId: string;
}): string {
  return sha256(
    JSON.stringify([
      parts.spaceId ?? null,
      parts.userId ?? null,
      parts.botId,
      parts.threadId,
      parts.provider,
      parts.connectionId ?? null,
      parts.baseUrl ?? null,
      parts.modelId,
    ]),
  );
}

interface SessionRecord {
  setup: string;
  shown: ShownMessage[];
  blocks: LiveBlock[];
  /** Hash of the last live text the model was shown; "" when none is current. */
  liveHash: string;
  ok: boolean;
  at: number;
  staleLiveTokens: number;
}

/**
 * What each turn showed the model, in memory, so the next turn can go on from it. A miss costs
 * exactly a fresh start; a restarted or different worker simply has no records.
 */
export class PromptSessions {
  private readonly records = new Map<string, SessionRecord>();
  private readonly running = new Set<string>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: { now?: () => number; maxEntries?: number } = {}) {
    this.now = options.now ?? Date.now;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  begin(
    key: string,
    input: { setup: string; shown: ShownMessage[]; live: string; retentionMs?: number },
  ): PromptSessionPlan {
    if (this.running.has(key)) return { resume: false, reason: "busy", owner: false };
    this.running.add(key);
    const fresh = (reason: FreshReason): PromptSessionPlan => ({
      resume: false,
      reason,
      owner: true,
    });
    const record = this.records.get(key);
    if (!record) return fresh("new");
    if (record.setup !== input.setup) return fresh("setup");
    if (!record.ok) return fresh("failed");
    if (input.retentionMs !== undefined && this.now() - record.at > input.retentionMs)
      return fresh("expired");
    if (record.staleLiveTokens > MAX_STALE_LIVE_TOKENS) return fresh("stale-live");

    const seen = new Map(record.shown.map((message) => [message.id, message.hash]));
    let sawUnseen = false;
    const present = new Set<string>();
    for (const message of input.shown) {
      const hash = seen.get(message.id);
      if (hash === undefined) {
        sawUnseen = true;
        continue;
      }
      if (sawUnseen) return fresh("inserted");
      if (hash !== message.hash) return fresh("edited");
      present.add(message.id);
    }
    if (present.size < seen.size) return fresh("missing");

    const liveHash = input.live ? sha256(input.live) : "";
    const sendLive = liveHash === record.liveHash ? false : liveHash ? "changed" : "emptied";
    return { resume: true, replay: record.blocks, sendLive, owner: true };
  }

  end(
    key: string,
    plan: PromptSessionPlan,
    outcome: {
      ok: boolean;
      setup: string;
      shown: ShownMessage[];
      live: string;
      sent?: LiveBlock;
      staleLiveTokens: number;
    },
  ): void {
    // A busy run never owned the record, so it must not touch it.
    if (!plan.owner) return;
    this.running.delete(key);
    const kept = plan.resume ? plan.replay : [];
    this.records.delete(key);
    this.records.set(key, {
      setup: outcome.setup,
      shown: outcome.shown,
      blocks: outcome.sent ? [...kept, outcome.sent] : kept,
      liveHash: outcome.live ? sha256(outcome.live) : "",
      ok: outcome.ok,
      at: this.now(),
      staleLiveTokens: outcome.staleLiveTokens,
    });
    while (this.records.size > this.maxEntries) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      this.records.delete(oldest);
    }
  }
}

interface TranscriptMetadata {
  corvoMessageId?: string;
  corvoCurrentTurn?: true;
  corvoLiveContext?: true;
}

const liveBlock = (text: string): Message =>
  ({
    role: "user",
    content: text,
    timestamp: 0,
    corvoLiveContext: true,
  }) as Message;

/**
 * Places live context in the history: replayed blocks before the message each was first sent
 * with, then the block for this turn right before the current user message (or at the end of
 * the history when there is none). A fresh start drops every earlier block.
 */
export function assembleTranscript(
  history: Message[],
  plan: PromptSessionPlan,
  live: string,
  beforeId: string | undefined,
): { messages: Message[]; sent?: LiveBlock; staleLiveTokens: number } {
  const replay = plan.resume ? plan.replay : [];
  const sendLive = plan.resume ? plan.sendLive : live ? "changed" : false;
  const newText = sendLive === "emptied" ? EMPTY_LIVE_CONTEXT : sendLive ? live : undefined;
  const messages: Message[] = [];
  const pending = new Map(replay.map((block) => [block.beforeId, block]));
  const currentIndex = history.findIndex(
    (message) => (message as Message & TranscriptMetadata).corvoCurrentTurn,
  );
  history.forEach((message, index) => {
    const id = (message as Message & TranscriptMetadata).corvoMessageId;
    const block = id ? pending.get(id) : undefined;
    if (block) {
      messages.push(liveBlock(block.text));
      pending.delete(id!);
    }
    if (newText !== undefined && index === currentIndex) messages.push(liveBlock(newText));
    messages.push(message);
  });
  if (pending.size > 0) throw new Error("A replayed live context block lost its message");
  if (newText !== undefined && currentIndex < 0) messages.push(liveBlock(newText));
  // The latest block still applies; every other one is only dead weight in the prefix.
  const superseded = newText !== undefined ? replay : replay.slice(0, -1);
  return {
    messages,
    ...(newText !== undefined && beforeId ? { sent: { beforeId, text: newText } } : {}),
    staleLiveTokens: superseded.reduce((sum, block) => sum + Math.ceil(block.text.length / 4), 0),
  };
}
