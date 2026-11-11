import { wikiCurateJob } from "@corvo/adapter-kit";
import { threadIsCurated } from "@corvo/adapters";
import type { WikiChange } from "@corvo/contracts";
import {
  applyAllWikiChanges,
  decideWikiChange,
  getWikiChange,
  getWikiSettings,
  importSharedMemoryOnce,
  listWikiChanges,
  listWikiPages,
  readWikiPage,
  removeWikiPage,
  restoreWikiRevision,
  searchWiki,
  setThreadWikiCapture,
  setWikiSettings,
  type WikiChangeRecord,
  WikiChangeStateError,
  WikiConflictError,
  WikiNotFoundError,
  WikiTitleError,
  wikiHistory,
  writeWikiPage,
} from "@corvo/db";
import { getLogger } from "@corvo/logging";
import { ORPCError } from "@orpc/server";
import { requireSpaceOwner } from "../space-owner.js";
import { resolveThreadTarget } from "../thread-target.js";
import type { RouterContext } from "./context.js";

/** What the store refuses, as the procedure's own errors. */
function asRpcError(error: unknown): never {
  if (error instanceof WikiConflictError)
    throw new ORPCError("CONFLICT", { message: error.message });
  if (error instanceof WikiTitleError)
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  if (error instanceof WikiNotFoundError)
    throw new ORPCError("NOT_FOUND", { message: error.message });
  if (error instanceof WikiChangeStateError)
    throw new ORPCError("CONFLICT", { message: error.message });
  throw error;
}

/**
 * A change as a reader sees it. Every member sees what the curator proposed and the pages it
 * touches; the words quoted from the conversation are shown only to the person whose it was.
 */
export function wikiChangeView(record: WikiChangeRecord, viewerUserId: string): WikiChange {
  const canSeeSource = record.sourceUserId === viewerUserId;
  return {
    id: record.id,
    state: record.state,
    // The title and the reason are the model's summary of the conversation, so only the person
    // whose conversation it was is shown them. What would be written is page text, which every
    // member of the Space can read once it is in the wiki, so everyone sees it before approving.
    reason: canSeeSource ? record.reason : "",
    sourceTitle: canSeeSource ? record.sourceTitle : "",
    pages: record.pages,
    edits: record.edits,
    createdAt: record.createdAt.toISOString(),
    canSeeSource,
    ...(canSeeSource ? { sourceText: record.sourceText } : {}),
  };
}

/**
 * The space's shared wiki. Every member of the space may read and write it, so a procedure names
 * the actor's space and never limits pages to their author.
 */
export function wikiRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const db = deps.prisma;
  const scopeOf = (actor: { spaceId: string; userId: string }) => ({
    spaceId: actor.spaceId,
    userId: actor.userId,
  });
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      return asRpcError(error);
    }
  };
  return {
    wiki: {
      index: authed.wiki.index.handler(async ({ context }) => {
        // The first opening brings the person's shared memory in; after that this is a plain list.
        await importSharedMemoryOnce(db, scopeOf(context.actor));
        return listWikiPages(db, scopeOf(context.actor));
      }),
      search: authed.wiki.search.handler(({ context, input }) =>
        searchWiki(db, scopeOf(context.actor), input.query, input.limit),
      ),
      read: authed.wiki.read.handler(({ context, input }) =>
        guarded(async () => {
          const page = await readWikiPage(db, scopeOf(context.actor), input.title);
          if (!page) throw new WikiNotFoundError();
          return page;
        }),
      ),
      write: authed.wiki.write.handler(({ context, input }) =>
        guarded(() => writeWikiPage(db, scopeOf(context.actor), input)),
      ),
      history: authed.wiki.history.handler(({ context, input }) =>
        guarded(() => wikiHistory(db, scopeOf(context.actor), input.title)),
      ),
      restore: authed.wiki.restore.handler(({ context, input }) =>
        guarded(() => restoreWikiRevision(db, scopeOf(context.actor), input.title, input.revision)),
      ),
      remove: authed.wiki.remove.handler(async ({ context, input }) => {
        await removeWikiPage(db, scopeOf(context.actor), input.title);
        return { ok: true as const };
      }),
      changes: {
        list: authed.wiki.changes.list.handler(async ({ context, input }) =>
          (await listWikiChanges(db, scopeOf(context.actor), input)).map((record) =>
            wikiChangeView(record, context.actor.userId),
          ),
        ),
        get: authed.wiki.changes.get.handler(({ context, input }) =>
          guarded(async () => {
            const record = await getWikiChange(db, scopeOf(context.actor), input.changeId);
            if (!record) throw new WikiNotFoundError();
            return wikiChangeView(record, context.actor.userId);
          }),
        ),
        decide: authed.wiki.changes.decide.handler(({ context, input }) =>
          guarded(async () =>
            wikiChangeView(
              await decideWikiChange(db, scopeOf(context.actor), input.changeId, input.decision),
              context.actor.userId,
            ),
          ),
        ),
        applyAll: authed.wiki.changes.applyAll.handler(({ context }) =>
          applyAllWikiChanges(db, scopeOf(context.actor)),
        ),
      },
      settings: {
        get: authed.wiki.settings.get.handler(({ context }) =>
          getWikiSettings(db, context.actor.spaceId),
        ),
        // These settings decide what is learned from everyone's conversations and whether edits wait
        // for approval, so only an owner of the Space changes them.
        set: authed.wiki.settings.set.handler(async ({ context, input }) => {
          await requireSpaceOwner(db, context.actor);
          return setWikiSettings(db, context.actor.spaceId, input);
        }),
      },
      keep: authed.wiki.keep.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(db, context.actor, input);
        const message = await db.message.findFirst({
          where: { id: input.messageId, threadId: target.threadId },
          select: { id: true },
        });
        if (!message) throw new ORPCError("NOT_FOUND", { message: "There is no such message." });
        // The queued read is durable; a missed wake is repaired by the job reconciler.
        await deps.jobs
          .enqueue(wikiCurateJob(target.threadId, { messageId: message.id }))
          .catch((error) => getLogger().error("wiki keep enqueue", error));
        return { ok: true as const };
      }),
      capture: {
        get: authed.wiki.capture.get.handler(async ({ context, input }) => {
          const target = await resolveThreadTarget(db, context.actor, input);
          const thread = await db.thread.findFirst({
            where: { id: target.threadId, spaceId: context.actor.spaceId },
            select: {
              id: true,
              spaceId: true,
              userId: true,
              groupId: true,
              botId: true,
              externalConversationId: true,
              wikiCapture: true,
            },
          });
          if (!thread)
            throw new ORPCError("NOT_FOUND", { message: "There is no such conversation." });
          const settings = await getWikiSettings(db, thread.spaceId);
          const available = settings.capture && Boolean(thread.groupId ?? thread.botId);
          return {
            available,
            capture: thread.wikiCapture,
            on: available && (await threadIsCurated(db, thread)),
            canChange: thread.userId === context.actor.userId,
          };
        }),
        set: authed.wiki.capture.set.handler(async ({ context, input }) => {
          const target = await resolveThreadTarget(db, context.actor, input);
          const saved = await setThreadWikiCapture(
            db,
            {
              threadId: target.threadId,
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
            },
            input.capture,
          );
          if (!saved)
            throw new ORPCError("NOT_FOUND", { message: "There is no such conversation." });
          return { ok: true as const };
        }),
      },
    },
  };
}
