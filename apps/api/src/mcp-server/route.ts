import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  findMcpAccessKey,
  proposeUserMemory,
  recordSecurityEvent,
  requireMembership,
  runAsSystem,
  runAsTenant,
  touchMcpAccessKey,
} from "@corvo/db";
import { enrichLogContext } from "@corvo/logging";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import type { McpAppClient } from "./app-client.js";
import type { McpRateLimiter } from "./rate-limit.js";
import type { McpCaller, McpToolDeps } from "./tools.js";
import { McpToolError, registerMcpTools } from "./tools.js";

/** The path the endpoint answers on, relative to the API's own origin. */
export const MCP_PATH = "/mcp";

const INSTRUCTIONS =
  "Rook agents and the work around them. Start with list_agents or list_channels, then send_message to talk to one. Calls act as the key's owner and follow the same approvals as the app.";

export interface McpRouteDeps {
  prisma: PrismaClient;
  /** The app's own procedures as one actor: every tool goes through them, never around them. */
  client(actor: Actor): McpAppClient;
  limiter: McpRateLimiter;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The tool dependencies the endpoint hands to every call. */
export function createMcpToolDeps(deps: McpRouteDeps): McpToolDeps {
  const { prisma } = deps;
  return {
    client: deps.client,
    async actorFor(caller: McpCaller, requested: string | undefined) {
      if (caller.spaceId && requested && requested !== caller.spaceId)
        throw new McpToolError("This key is limited to another space.");
      try {
        return await requireMembership(prisma, caller.userId, caller.spaceId ?? requested);
      } catch {
        // Whether the space exists or the owner left it, the key reaches nothing there.
        throw new McpToolError("No access to that space.");
      }
    },
    async suggestMemory(actor, text) {
      const result = await runAsTenant(actor, () =>
        proposeUserMemory(
          prisma,
          { spaceId: actor.spaceId, userId: actor.userId },
          { text, source: "agent", state: "pending" },
        ),
      );
      return result.outcome;
    },
    audit: (entry) =>
      recordSecurityEvent({
        type: "mcp.tool_call",
        userId: entry.caller.userId,
        spaceId: entry.spaceId,
        metadata: {
          keyId: entry.caller.keyId,
          level: entry.caller.level,
          tool: entry.tool,
          target: entry.target,
          outcome: entry.outcome,
        },
      }),
    sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    now: deps.now ?? Date.now,
  };
}

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return match?.[1] ?? null;
}

/**
 * Mounts the Streamable HTTP MCP endpoint. A key in the `Authorization` header says who is
 * calling; each request builds its own server holding only the tools that key's level unlocks, so
 * nothing is kept between requests and there is no session to hijack.
 */
export function mountMcpRoute(app: Hono, deps: McpRouteDeps): void {
  const tools = createMcpToolDeps(deps);
  const now = deps.now ?? Date.now;
  app.all(MCP_PATH, async (c) => {
    // Without a session there is no stream to open or end, so only requests are served.
    if (c.req.method !== "POST") return jsonRpcError(405, "Use POST.", { allow: "POST" });
    const secret = bearer(c.req.header("authorization"));
    const key = secret
      ? await runAsSystem("mcp key lookup", () => findMcpAccessKey(deps.prisma, secret))
      : null;
    if (!key)
      return jsonRpcError(401, "A valid key is required.", { "www-authenticate": "Bearer" });
    const taken = deps.limiter.take(key.id);
    if (!taken.ok) {
      return jsonRpcError(429, "Too many calls. Try again shortly.", {
        "retry-after": String(taken.retryAfterSeconds),
      });
    }
    await runAsSystem("mcp key last used", () =>
      touchMcpAccessKey(deps.prisma, key, new Date(now())),
    ).catch(() => undefined);
    enrichLogContext({ "user.id": key.userId });

    const caller: McpCaller = {
      keyId: key.id,
      keyName: key.name,
      userId: key.userId,
      level: key.level,
      spaceId: key.spaceId,
    };
    const server = new McpServer(
      { name: "rook", version: "1.0.0" },
      { instructions: INSTRUCTIONS },
    );
    registerMcpTools(server, caller, tools);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close().catch(() => undefined);
    }
  });
}
