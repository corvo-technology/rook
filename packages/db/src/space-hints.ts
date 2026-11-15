import type { RealtimeFanout } from "@corvo/adapter-kit";
import type { SpaceHint, SpaceHintKind } from "@corvo/contracts";
import type { PrismaClient } from "./client.js";
import { runAsSystem } from "./row-security.js";

/**
 * Who a hint reaches inside a space. No reach means every member. Otherwise the named people,
 * the holders of the named roles, and, for a private channel, whoever holds `manage_channels`:
 * the same people the permission-checked reads show the change to.
 */
export interface HintReach {
  users?: readonly string[];
  roles?: readonly string[];
  managers?: boolean;
}

/** The member a stream belongs to. `roleIds` and `manageChannels` are refreshed while it is open. */
export interface HintViewer {
  userId: string;
  roleIds: readonly string[];
  manageChannels: boolean;
}

/** Most ids one notification carries, so a large private channel stays under the NOTIFY limit. */
const REACH_CHUNK = 60;
/** The fewest milliseconds between hints for one thread: a streaming reply is one change, not many. */
const THREAD_HINT_COOLDOWN_MS = 1_500;

export function spaceHintTopic(spaceId: string): string {
  return `space-hints:${spaceId}`;
}

export function hintReaches(reach: HintReach | undefined, viewer: HintViewer): boolean {
  if (!reach) return true;
  return (
    Boolean(reach.users?.includes(viewer.userId)) ||
    Boolean(reach.roles?.some((roleId) => viewer.roleIds.includes(roleId))) ||
    (reach.managers === true && viewer.manageChannels)
  );
}

/**
 * Content-free "this changed" hints for the members of a space. They ride the existing realtime
 * fan-out: a process listens once for all of its streams, and each stream is an in-memory
 * subscriber. A stream holds no database connection, and a hint names no row and no text.
 */
export interface SpaceHints {
  publish(spaceId: string, kinds: readonly SpaceHintKind[], reach?: HintReach): Promise<void>;
  /** The hints the viewer may see. Frames queue while the consumer is busy; kinds coalesce. */
  follow(spaceId: string, viewer: HintViewer, signal?: AbortSignal): AsyncGenerator<SpaceHint>;
}

interface Envelope {
  kinds: SpaceHintKind[];
  reach?: HintReach;
}

export function createSpaceHints(realtime?: RealtimeFanout): SpaceHints {
  return {
    async publish(spaceId, kinds, reach) {
      if (!realtime || kinds.length === 0) return;
      const topic = spaceHintTopic(spaceId);
      const users = reach?.users ?? [];
      const chunks: Array<readonly string[] | undefined> = [];
      if (!reach) chunks.push(undefined);
      else if (users.length <= REACH_CHUNK) chunks.push(users);
      else
        for (let i = 0; i < users.length; i += REACH_CHUNK)
          chunks.push(users.slice(i, i + REACH_CHUNK));
      for (const chunk of chunks) {
        const envelope: Envelope = {
          kinds: [...kinds],
          ...(reach
            ? {
                reach: {
                  ...(chunk?.length ? { users: chunk } : {}),
                  ...(reach.roles?.length ? { roles: reach.roles } : {}),
                  ...(reach.managers ? { managers: true } : {}),
                },
              }
            : {}),
        };
        await realtime.publish(topic, JSON.stringify(envelope)).catch(() => undefined);
      }
    },
    async *follow(spaceId, viewer, signal) {
      const queue: SpaceHintKind[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = realtime
        ? await realtime
            .subscribe(spaceHintTopic(spaceId), (payload) => {
              let envelope: Envelope;
              try {
                envelope = JSON.parse(payload) as Envelope;
              } catch {
                // An empty payload is the fan-out's catch-up signal after it reconnected.
                for (const kind of ALL_KINDS) if (!queue.includes(kind)) queue.push(kind);
                wake?.();
                return;
              }
              if (!Array.isArray(envelope.kinds) || !hintReaches(envelope.reach, viewer)) return;
              for (const kind of envelope.kinds) {
                if (ALL_KINDS.includes(kind) && !queue.includes(kind)) queue.push(kind);
              }
              wake?.();
            })
            .catch(() => async () => {})
        : async () => {};
      try {
        while (!signal?.aborted) {
          const kind = queue.shift();
          if (kind) {
            yield { kind, createdAt: new Date().toISOString() };
            continue;
          }
          await new Promise<void>((resolve) => {
            const done = () => {
              wake = undefined;
              signal?.removeEventListener("abort", done);
              resolve();
            };
            wake = done;
            signal?.addEventListener("abort", done, { once: true });
            if (signal?.aborted) done();
          });
        }
      } finally {
        wake = undefined;
        await unsubscribe();
      }
    },
  };
}

const ALL_KINDS: readonly SpaceHintKind[] = [
  "roster",
  "approvals",
  "dm",
  "computer",
  "routines",
  "notifications",
  "presence",
];

/** What a change in a conversation can move, and who sees that conversation. */
export async function threadHintTarget(
  prisma: Pick<PrismaClient, "thread">,
  threadId: string,
): Promise<{ spaceId: string; kinds: SpaceHintKind[]; reach?: HintReach } | null> {
  const thread = await runAsSystem("work out who a conversation's change reaches", () =>
    prisma.thread.findUnique({
      where: { id: threadId },
      select: {
        spaceId: true,
        direct: { select: { userAId: true, userBId: true } },
        group: {
          select: {
            userId: true,
            accessRoleIds: true,
            people: { select: { userId: true } },
          },
        },
        bot: botAudienceSelect,
        externalConversation: { select: { bot: botAudienceSelect } },
      },
    }),
  );
  if (!thread) return null;
  const { spaceId } = thread;
  if (thread.direct) {
    return {
      spaceId,
      kinds: ["dm", "notifications"],
      reach: { users: [thread.direct.userAId, thread.direct.userBId] },
    };
  }
  const kinds: SpaceHintKind[] = ["roster", "approvals", "notifications"];
  if (thread.group) {
    const { group } = thread;
    if (group.people.length === 0 && group.accessRoleIds.length === 0) return { spaceId, kinds };
    return {
      spaceId,
      kinds,
      reach: {
        users: [group.userId, ...group.people.map((person) => person.userId)],
        roles: group.accessRoleIds,
        managers: true,
      },
    };
  }
  const bot = thread.bot ?? thread.externalConversation?.bot;
  if (!bot) return { spaceId, kinds };
  return { spaceId, kinds, reach: botReach(bot) };
}

const botAudienceSelect = {
  select: {
    userId: true,
    audienceRestricted: true,
    audienceRoleIds: true,
    audienceUserIds: true,
  },
} as const;

/** The same people `inAudience` lets in: the owner, the people named and the holders of a named role. */
export function botReach(bot: {
  userId: string;
  audienceRestricted: boolean;
  audienceRoleIds: readonly string[];
  audienceUserIds: readonly string[];
}): HintReach | undefined {
  if (!bot.audienceRestricted) return undefined;
  return { users: [bot.userId, ...bot.audienceUserIds], roles: bot.audienceRoleIds };
}

/** Hints for a bot's own changes (its routines, its settings) reach whoever may talk to it. */
export async function botHintReach(
  prisma: Pick<PrismaClient, "bot">,
  spaceId: string,
  botId: string,
): Promise<HintReach | undefined> {
  const bot = await runAsSystem("work out who an agent's change reaches", () =>
    prisma.bot.findFirst({ where: { id: botId, spaceId }, ...botAudienceSelect }),
  );
  return bot ? botReach(bot) : { users: [] };
}

/** Hints for a channel's own changes reach whoever sees the channel. */
export async function groupHintReach(
  prisma: Pick<PrismaClient, "chatGroup">,
  spaceId: string,
  groupId: string,
): Promise<HintReach | undefined> {
  const group = await runAsSystem("work out who a channel's change reaches", () =>
    prisma.chatGroup.findFirst({
      where: { id: groupId, spaceId },
      select: { userId: true, accessRoleIds: true, people: { select: { userId: true } } },
    }),
  );
  if (!group) return { users: [] };
  if (group.people.length === 0 && group.accessRoleIds.length === 0) return undefined;
  return {
    users: [group.userId, ...group.people.map((person) => person.userId)],
    roles: group.accessRoleIds,
    managers: true,
  };
}

const lastThreadHint = new Map<string, number>();
const pendingThreadHint = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Tells the members who see a conversation that its list rows may have changed. A burst on one
 * thread (every step of a streaming reply) sends one hint now and one when it settles.
 */
export function hintThreadChange(
  prisma: Pick<PrismaClient, "thread">,
  hints: SpaceHints,
  threadId: string,
): void {
  const send = () => {
    lastThreadHint.set(threadId, Date.now());
    void threadHintTarget(prisma, threadId)
      .then((target) => target && hints.publish(target.spaceId, target.kinds, target.reach))
      .catch(() => undefined);
  };
  const since = Date.now() - (lastThreadHint.get(threadId) ?? 0);
  if (since >= THREAD_HINT_COOLDOWN_MS) {
    send();
    return;
  }
  if (pendingThreadHint.has(threadId)) return;
  const timer = setTimeout(() => {
    pendingThreadHint.delete(threadId);
    send();
  }, THREAD_HINT_COOLDOWN_MS - since);
  timer.unref?.();
  pendingThreadHint.set(threadId, timer);
  if (lastThreadHint.size > 2_000) {
    const cutoff = Date.now() - THREAD_HINT_COOLDOWN_MS;
    for (const [id, at] of lastThreadHint) if (at < cutoff) lastThreadHint.delete(id);
  }
}
