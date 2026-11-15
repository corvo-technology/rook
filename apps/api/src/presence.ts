import type { PresenceStatus } from "@corvo/contracts";

/** Connected, but nothing from the client for this long, reads as away. */
const AWAY_AFTER_MS = 5 * 60_000;
/** A page reload drops and reopens the stream; the member stays as they were this long. */
const DISCONNECT_GRACE_MS = 10_000;
/** A member this process has never seen but who was seen this recently is probably on another instance. */
const SEEN_FALLBACK_MS = 2 * 60_000;
/** How often the stored `lastSeenAt` of a connected member is refreshed. */
const SEEN_WRITE_MS = 60_000;
const FORGET_AFTER_MS = 10 * 60_000;

interface Entry {
  spaceId: string;
  userId: string;
  connections: number;
  /** When the client last said it was in use; 0 while it is in the background. */
  activeAt: number;
  /** Set when the last stream closed: the member counts as gone once the grace ends. */
  leftAt: number | null;
  seenWrittenAt: number;
  published: PresenceStatus;
}

export interface PresenceOptions {
  now?: () => number;
  /** Called when a member's status changes, so the space's streams can say so. */
  onChange: (spaceId: string) => void;
  /** Stores `lastSeenAt`; a failure is the caller's to swallow. */
  persistSeen: (spaceId: string, userId: string, at: Date) => Promise<void>;
}

/**
 * Who is here, per API instance: online while a stream is open and the client is in use, away
 * when it is in the background or quiet, offline when no stream is open. Another instance's
 * members are unknown here, so a recently stored `lastSeenAt` stands in for them as away. Nothing
 * is stored per transition; only `lastSeenAt` is written, at most once a minute per member.
 */
export class PresenceTracker {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: PresenceOptions) {
    this.now = options.now ?? Date.now;
  }

  /** Starts the timer that notices a member going quiet or leaving. */
  start(intervalMs = 30_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
  }

  /** A stream opened. Returns the call that closes it. */
  connect(spaceId: string, userId: string): () => void {
    const key = `${spaceId}:${userId}`;
    const entry = this.entries.get(key) ?? {
      spaceId,
      userId,
      connections: 0,
      activeAt: 0,
      leftAt: null,
      seenWrittenAt: 0,
      published: "offline" as PresenceStatus,
    };
    this.entries.set(key, entry);
    entry.connections += 1;
    entry.leftAt = null;
    entry.activeAt = this.now();
    this.settle(spaceId, userId, entry);
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      entry.connections = Math.max(0, entry.connections - 1);
      if (entry.connections === 0) {
        entry.leftAt = this.now();
        this.persist(spaceId, userId, entry, true);
      }
    };
  }

  /** The client is in use (foreground) or not. */
  touch(spaceId: string, userId: string, active: boolean): void {
    const entry = this.entries.get(`${spaceId}:${userId}`);
    if (!entry || entry.connections === 0) return;
    entry.activeAt = active ? this.now() : 0;
    this.settle(spaceId, userId, entry);
  }

  statusOf(spaceId: string, userId: string, lastSeenAt: Date | null): PresenceStatus {
    const entry = this.entries.get(`${spaceId}:${userId}`);
    if (!entry) {
      return lastSeenAt && this.now() - lastSeenAt.getTime() < SEEN_FALLBACK_MS
        ? "away"
        : "offline";
    }
    return this.computed(entry);
  }

  private computed(entry: Entry): PresenceStatus {
    const now = this.now();
    if (entry.connections === 0) {
      return entry.leftAt !== null && now - entry.leftAt < DISCONNECT_GRACE_MS ? "away" : "offline";
    }
    return entry.activeAt > 0 && now - entry.activeAt < AWAY_AFTER_MS ? "online" : "away";
  }

  private settle(spaceId: string, userId: string, entry: Entry): void {
    const status = this.computed(entry);
    if (entry.connections > 0) this.persist(spaceId, userId, entry, false);
    if (status === entry.published) return;
    entry.published = status;
    this.options.onChange(spaceId);
  }

  private persist(spaceId: string, userId: string, entry: Entry, force: boolean): void {
    const now = this.now();
    if (!force && now - entry.seenWrittenAt < SEEN_WRITE_MS) return;
    entry.seenWrittenAt = now;
    void this.options.persistSeen(spaceId, userId, new Date(now)).catch(() => undefined);
  }

  /** Publishes the changes that happen with no event: going quiet, and a grace that ended. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      this.settle(entry.spaceId, entry.userId, entry);
      if (
        entry.connections === 0 &&
        entry.leftAt !== null &&
        now - entry.leftAt > FORGET_AFTER_MS
      ) {
        this.entries.delete(key);
      }
    }
  }
}
