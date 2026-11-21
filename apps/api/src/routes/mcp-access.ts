import {
  createMcpAccessKey,
  listMcpAccessKeys,
  McpAccessKeyLimitError,
  McpAccessKeyNotFoundError,
  McpAccessKeySpaceError,
  recordSecurityEvent,
  revokeMcpAccessKey,
} from "@corvo/db";
import { ORPCError } from "@orpc/server";
import type { RouterContext } from "./context.js";

/** What the store refuses, as the procedure's own errors. */
function asRpcError(error: unknown): never {
  if (error instanceof McpAccessKeyNotFoundError || error instanceof McpAccessKeySpaceError)
    throw new ORPCError("NOT_FOUND", { message: error.message });
  if (error instanceof McpAccessKeyLimitError)
    throw new ORPCError("BAD_REQUEST", { message: error.message });
  throw error;
}

/**
 * The keys a person hands to an MCP client. They are the person's alone: every procedure names the
 * actor's own user, and someone else's key is simply not found.
 */
export function mcpAccessRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const db = deps.prisma;
  return {
    mcpAccess: {
      list: authed.mcpAccess.list.handler(({ context }) =>
        listMcpAccessKeys(db, context.actor.userId),
      ),
      create: authed.mcpAccess.create.handler(async ({ context, input }) => {
        const created = await createMcpAccessKey(db, context.actor.userId, input).catch(asRpcError);
        await recordSecurityEvent({
          type: "mcp.key.created",
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          metadata: {
            keyId: created.key.id,
            level: created.key.level,
            limitedToSpace: created.key.spaceId !== null,
          },
        });
        return created;
      }),
      revoke: authed.mcpAccess.revoke.handler(async ({ context, input }) => {
        await revokeMcpAccessKey(db, context.actor.userId, input.keyId).catch(asRpcError);
        await recordSecurityEvent({
          type: "mcp.key.revoked",
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          metadata: { keyId: input.keyId },
        });
        return { ok: true as const };
      }),
    },
  };
}
