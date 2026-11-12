import {
  addUserMemory,
  decideUserMemory,
  editUserMemory,
  getMemoryLearning,
  getUserMemory,
  listUserMemories,
  setMemoryLearning,
  UserMemoryNotFoundError,
  UserMemoryStateError,
  UserMemoryTextError,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";

/** What the store refuses, as the procedure's own errors. */
function asRpcError(error: unknown): never {
  if (error instanceof UserMemoryNotFoundError)
    throw new ORPCError("NOT_FOUND", { message: error.message });
  if (error instanceof UserMemoryTextError)
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  if (error instanceof UserMemoryStateError)
    throw new ORPCError("CONFLICT", { message: error.message });
  throw error;
}

/**
 * What a person's agents know about them. It is the person's alone: every procedure names the
 * actor's own space and user, and a memory of someone else is simply not found.
 */
export function youRoutes(ctx: RouterContext) {
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
    you: {
      list: authed.you.list.handler(({ context, input }) =>
        listUserMemories(db, scopeOf(context.actor), input),
      ),
      get: authed.you.get.handler(({ context, input }) =>
        guarded(async () => {
          const memory = await getUserMemory(db, scopeOf(context.actor), input.memoryId);
          if (!memory) throw new UserMemoryNotFoundError();
          return memory;
        }),
      ),
      // The person typed it themselves, so it is saved at once.
      add: authed.you.add.handler(({ context, input }) =>
        guarded(() => addUserMemory(db, scopeOf(context.actor), input.text)),
      ),
      edit: authed.you.edit.handler(({ context, input }) =>
        guarded(() => editUserMemory(db, scopeOf(context.actor), input.memoryId, input.text)),
      ),
      decide: authed.you.decide.handler(({ context, input }) =>
        guarded(() => decideUserMemory(db, scopeOf(context.actor), input.memoryId, input.decision)),
      ),
      settings: {
        get: authed.you.settings.get.handler(async ({ context }) => ({
          learn: await getMemoryLearning(db, scopeOf(context.actor)),
        })),
        set: authed.you.settings.set.handler(async ({ context, input }) => {
          const scope = scopeOf(context.actor);
          const learn =
            input.learn === undefined
              ? await getMemoryLearning(db, scope)
              : await setMemoryLearning(db, scope, input.learn);
          return { learn };
        }),
      },
    },
  };
}
