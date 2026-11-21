import type { McpAccessLevel } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { hashMcpAccessSecret } from "@corvo/db";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { McpAppClient } from "./app-client.js";
import { createMcpRateLimiter } from "./rate-limit.js";
import { mountMcpRoute } from "./route.js";

const SECRET = "rk_test-secret-value";

type KeyRow = {
  id: string;
  userId: string;
  name: string;
  level: McpAccessLevel;
  spaceId: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

function setup(
  options: {
    key?: Partial<KeyRow> | null;
    memberships?: Array<{ userId: string; spaceId: string }>;
    limit?: number;
    client?: McpAppClient;
  } = {},
) {
  const row: KeyRow | null =
    options.key === null
      ? null
      : {
          id: "key-1",
          userId: "user-1",
          name: "laptop",
          level: "read",
          spaceId: null,
          lastUsedAt: null,
          revokedAt: null,
          ...options.key,
        };
  const memberships = options.memberships ?? [{ userId: "user-1", spaceId: "space-a" }];
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    mcpAccessKey: {
      findUnique: vi.fn(async ({ where }: { where: { secretHash: string } }) =>
        row && where.secretHash === hashMcpAccessSecret(SECRET) ? row : null,
      ),
      updateMany,
    },
    spaceMember: {
      findFirst: vi.fn(async ({ where }: { where: { userId: string; spaceId?: string } }) => {
        const found = memberships.find(
          (entry) =>
            entry.userId === where.userId && (!where.spaceId || entry.spaceId === where.spaceId),
        );
        return found
          ? {
              userId: found.userId,
              spaceId: found.spaceId,
              member: { user: { email: "o@example.test" } },
            }
          : null;
      }),
    },
  } as unknown as PrismaClient;
  const client =
    options.client ??
    ({
      bots: {
        list: async () => [
          { id: "bot-1", name: "Ana", title: "Support", description: "", status: "idle" },
        ],
      },
    } as unknown as McpAppClient);
  const app = new Hono();
  mountMcpRoute(app, {
    prisma,
    client: () => client,
    limiter: createMcpRateLimiter({ limit: options.limit ?? 100 }),
    now: () => Date.parse("2026-02-01T00:00:00Z"),
  });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${SECRET}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { app, post, prisma, updateMany };
}

const rpc = (method: string, params: unknown = {}, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
});
const INIT = rpc("initialize", {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "test", version: "0" },
});

describe("MCP endpoint authentication", () => {
  it("refuses a request with no key, a wrong key or a revoked one", async () => {
    expect((await setup().post(INIT, { authorization: "" })).status).toBe(401);
    expect((await setup().post(INIT, { authorization: "Bearer rk_other" })).status).toBe(401);
    expect((await setup().post(INIT, { authorization: "Bearer not-a-key" })).status).toBe(401);
    expect((await setup({ key: { revokedAt: new Date() } }).post(INIT)).status).toBe(401);
    const none = await setup({ key: null }).post(INIT);
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("serves only POST, since no session or stream is kept", async () => {
    const { app } = setup();
    const response = await app.request("/mcp", {
      method: "GET",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(response.status).toBe(405);
  });

  it("initializes and lists the tools of the key's level", async () => {
    const { post } = setup({ key: { level: "read" } });
    expect((await post(INIT)).status).toBe(200);
    const listed = await (await post(rpc("tools/list"))).json();
    const names = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("list_agents");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("create_agent");
  });

  it("notes that the key was used", async () => {
    const { post, updateMany } = setup();
    await post(INIT);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "key-1", revokedAt: null },
      data: { lastUsedAt: new Date("2026-02-01T00:00:00Z") },
    });
  });
});

describe("MCP endpoint calls", () => {
  const call = (name: string, args: Record<string, unknown> = {}) =>
    rpc("tools/call", { name, arguments: args });

  it("runs a tool as the key's owner", async () => {
    const { post } = setup();
    const response = await (await post(call("list_agents"))).json();
    expect(JSON.parse(response.result.content[0].text)).toEqual([
      { id: "bot-1", name: "Ana", role: "Support", status: "idle" },
    ]);
  });

  it("never reaches a space its owner is not in", async () => {
    const { post } = setup({ key: { level: "read" } });
    const response = await (await post(call("list_agents", { space: "space-b" }))).json();
    expect(response.result).toMatchObject({
      isError: true,
      content: [{ text: "No access to that space." }],
    });
  });

  it("follows the owner out of a space the key is limited to", async () => {
    const { post } = setup({ key: { spaceId: "space-a" }, memberships: [] });
    const response = await (await post(call("list_agents"))).json();
    expect(response.result.isError).toBe(true);
  });

  it("limits the calls of one key and says when to retry", async () => {
    const { post } = setup({ limit: 2 });
    expect((await post(INIT)).status).toBe(200);
    expect((await post(INIT)).status).toBe(200);
    const limited = await post(INIT);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
