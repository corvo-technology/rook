import type { Actor, McpAccessLevel } from "@corvo/contracts";
import { MCP_TOOL_LEVELS } from "@corvo/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { McpAppClient } from "./app-client.js";
import type { McpAuditEntry, McpCaller, McpToolDeps } from "./tools.js";
import { MCP_TOOLS, McpToolError, mcpToolsFor, registerMcpTools } from "./tools.js";

const actorOf = (spaceId: string): Actor => ({
  userId: "user-1",
  spaceId,
  email: "owner@example.test",
  isDeploymentOwner: false,
});

const callerOf = (level: McpAccessLevel, spaceId: string | null = null): McpCaller => ({
  keyId: "key-1",
  keyName: "laptop",
  userId: "user-1",
  level,
  spaceId,
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    async (..._args: unknown[]) => {
      calls.push(name);
      return result;
    };
  const client = {
    spaces: {
      list: record("spaces.list", {
        spaces: [
          { id: "space-a", name: "Home", isDefault: true },
          { id: "space-b", name: "Work", isDefault: false },
        ],
      }),
    },
    bots: {
      list: record("bots.list", [
        {
          id: "bot-1",
          name: "Ana",
          title: "Support",
          description: "",
          status: "idle",
          preview: "hello",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ]),
      create: vi.fn(record("bots.create", { id: "bot-2", name: "New" })),
      update: vi.fn(record("bots.update", { id: "bot-1", name: "Ana" })),
    },
    groups: {
      list: record("groups.list", [
        {
          id: "group-1",
          name: "ops",
          purpose: null,
          members: [{}, {}],
          preview: "",
          updatedAt: "2026-01-03T00:00:00.000Z",
        },
      ]),
    },
    threads: {
      get: vi.fn(record("threads.get", { messages: [], activeRuns: [] })),
      send: vi.fn(record("threads.send", { runId: "run-1", seq: 5 })),
    },
    tickets: {
      list: record("tickets.list", { tickets: [] }),
      get: record("tickets.get", { id: "t-1" }),
      comments: record("tickets.comments", []),
      create: vi.fn(record("tickets.create", { id: "t-1", ref: "OPS-1", status: "todo" })),
      comment: vi.fn(record("tickets.comment", { id: "c-1" })),
    },
    routines: {
      create: vi.fn(record("routines.create", { id: "r-1", name: "Digest", active: false })),
      update: vi.fn(record("routines.update", { id: "r-1", name: "Digest", active: false })),
    },
    wiki: {
      write: vi.fn(record("wiki.write", { title: "Notes", revision: 1 })),
    },
    ...overrides,
  };
  return { client: client as unknown as McpAppClient, raw: client, calls };
}

async function connect(
  caller: McpCaller,
  options: { client?: McpAppClient; deps?: Partial<McpToolDeps> } = {},
) {
  const audit: McpAuditEntry[] = [];
  const actors: Array<string | undefined> = [];
  const deps: McpToolDeps = {
    client: () => options.client ?? fakeClient().client,
    async actorFor(held, requested) {
      actors.push(requested);
      if (held.spaceId && requested && requested !== held.spaceId)
        throw new McpToolError("This key is limited to another space.");
      return actorOf(held.spaceId ?? requested ?? "space-a");
    },
    suggestMemory: async () => "created",
    audit: async (entry) => {
      audit.push(entry);
    },
    sleep: async () => undefined,
    now: () => 0,
    ...options.deps,
  };
  const server = new McpServer({ name: "rook-test", version: "0" });
  registerMcpTools(server, caller, deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return {
    client,
    audit,
    actors,
    call: async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
      return { isError: result.isError === true, text };
    },
    names: async () => (await client.listTools()).tools.map((entry) => entry.name).sort(),
  };
}

describe("tool surface", () => {
  it("offers each level exactly the tools it unlocks", async () => {
    const read = await connect(callerOf("read"));
    const talk = await connect(callerOf("talk"));
    const configure = await connect(callerOf("configure"));
    const byLevel = (level: McpAccessLevel) =>
      Object.entries(MCP_TOOL_LEVELS)
        .filter(([, required]) => required === level)
        .map(([name]) => name);
    expect(await read.names()).toEqual(byLevel("read").sort());
    expect(await talk.names()).toEqual([...byLevel("read"), ...byLevel("talk")].sort());
    expect(await configure.names()).toEqual(Object.keys(MCP_TOOL_LEVELS).sort());
  });

  it("implements exactly the tools the contract lists", () => {
    expect(Object.keys(MCP_TOOLS).sort()).toEqual(Object.keys(MCP_TOOL_LEVELS).sort());
    expect(mcpToolsFor("read")).not.toContain("send_message");
  });

  it("has no tool that deletes, decides, manages people or secrets, or loosens approvals", () => {
    const forbidden =
      /delete|remove|archive|approv|decide|(^|_)member|invite|people|secret|credential|password|permission|(^|_)role|autonomy|rule/i;
    for (const name of Object.keys(MCP_TOOLS)) expect(name).not.toMatch(forbidden);
  });

  it("reaches the app only through the procedures the narrow client lists", () => {
    const { client } = fakeClient();
    expect(Object.keys(client).sort()).toEqual(
      ["bots", "groups", "routines", "spaces", "threads", "tickets", "wiki"].sort(),
    );
    for (const group of Object.values(client as unknown as Record<string, object>)) {
      for (const procedure of Object.keys(group)) {
        expect(procedure).not.toMatch(/^(remove|delete|archive|decide|approve|rotate)/);
      }
    }
  });
});

describe("level enforcement", () => {
  it("does not let a read key call a talk tool", async () => {
    const session = await connect(callerOf("read"));
    const result = await session.call("send_message", { agentId: "bot-1", text: "hi" });
    expect(result.isError).toBe(true);
    expect(await session.audit).toEqual([]);
  });

  it("does not let a talk key configure", async () => {
    const { client, raw } = fakeClient();
    const session = await connect(callerOf("talk"), { client });
    for (const name of ["create_agent", "update_agent", "create_routine", "remember"]) {
      expect((await session.call(name, { agentId: "bot-1", name: "x" })).isError).toBe(true);
    }
    expect(raw.bots.create).not.toHaveBeenCalled();
    expect(raw.bots.update).not.toHaveBeenCalled();
    expect(raw.routines.create).not.toHaveBeenCalled();
  });

  it("cannot call a tool that does not exist, whatever the level", async () => {
    const session = await connect(callerOf("configure"));
    for (const name of ["delete_agent", "decide_approval", "list_secrets", "add_member"]) {
      expect((await session.call(name)).isError).toBe(true);
    }
  });
});

describe("space scoping", () => {
  it("refuses another space for a key limited to one", async () => {
    const session = await connect(callerOf("read", "space-a"));
    const result = await session.call("list_agents", { space: "space-b" });
    expect(result).toMatchObject({ isError: true, text: "This key is limited to another space." });
  });

  it("uses the key's space when none is named, and the named space for an open key", async () => {
    const scoped = await connect(callerOf("read", "space-a"));
    await scoped.call("list_agents");
    expect(scoped.audit[0]?.spaceId).toBe("space-a");
    const open = await connect(callerOf("read"));
    await open.call("list_agents", { space: "space-b" });
    expect(open.audit[0]?.spaceId).toBe("space-b");
  });

  it("lists only the key's space", async () => {
    const scoped = await connect(callerOf("read", "space-b"));
    const result = await scoped.call("list_spaces");
    expect(JSON.parse(result.text)).toEqual([{ id: "space-b", name: "Work", default: false }]);
  });
});

describe("audit", () => {
  it("records the key, tool and target of each call without the message", async () => {
    const session = await connect(callerOf("talk"));
    await session.call("send_message", {
      agentId: "bot-1",
      text: "the private plan",
      waitSeconds: 0,
    });
    expect(session.audit).toEqual([
      {
        caller: callerOf("talk"),
        spaceId: "space-a",
        tool: "send_message",
        target: "bot-1",
        outcome: "ok",
      },
    ]);
    expect(JSON.stringify(session.audit)).not.toContain("private plan");
  });

  it("records a failed call as an error", async () => {
    const { client } = fakeClient({
      tickets: {
        list: async () => ({ tickets: [] }),
        get: async () => {
          throw new Error("boom");
        },
        comments: async () => [],
      },
    });
    const session = await connect(callerOf("read"), { client });
    const result = await session.call("get_ticket", { ref: "OPS-1" });
    expect(result).toMatchObject({ isError: true, text: "Something went wrong." });
    expect(session.audit[0]).toMatchObject({ tool: "get_ticket", outcome: "error" });
  });
});

describe("send_message", () => {
  const reply = {
    id: "m-2",
    role: "bot",
    seq: 6,
    botId: "bot-1",
    blocks: [{ kind: "text", text: "Done: 3 invoices sent." }],
  };

  it("returns the agent's reply once its run finishes", async () => {
    const snapshots = [
      { messages: [], activeRuns: [{ id: "run-1", status: "running" }] },
      { messages: [reply], activeRuns: [] },
    ];
    const { client, raw } = fakeClient();
    raw.threads.get.mockImplementation(async () => snapshots.shift() ?? snapshots[0]);
    const sleep = vi.fn(async () => undefined);
    const session = await connect(callerOf("talk"), { client, deps: { sleep } });
    const result = await session.call("send_message", { agentId: "bot-1", text: "send them" });
    expect(JSON.parse(result.text)).toEqual({
      status: "replied",
      replies: [{ agentId: "bot-1", text: "Done: 3 invoices sent.", seq: 6 }],
      handle: { agentId: "bot-1", afterSeq: 5 },
    });
    expect(raw.threads.send).toHaveBeenCalledWith(
      expect.objectContaining({ botId: "bot-1", text: "send them" }),
    );
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("hands back a handle when the agent is still working at the deadline", async () => {
    let clock = 0;
    const { client, raw } = fakeClient();
    raw.threads.get.mockResolvedValue({
      messages: [],
      activeRuns: [{ id: "run-1", status: "running" }],
    });
    const session = await connect(callerOf("talk"), {
      client,
      deps: {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    });
    const result = await session.call("send_message", {
      agentId: "bot-1",
      text: "long job",
      waitSeconds: 5,
    });
    expect(JSON.parse(result.text)).toEqual({
      status: "running",
      replies: [],
      handle: { agentId: "bot-1", afterSeq: 5 },
    });
  });

  it("does not wait when asked not to, and says when the agent waits for the owner", async () => {
    const { client, raw } = fakeClient();
    const session = await connect(callerOf("talk"), { client });
    const immediate = await session.call("send_message", {
      agentId: "bot-1",
      text: "go",
      waitSeconds: 0,
    });
    expect(JSON.parse(immediate.text).status).toBe("running");
    expect(raw.threads.get).not.toHaveBeenCalled();

    raw.threads.get.mockResolvedValue({
      messages: [],
      activeRuns: [{ id: "run-1", status: "waiting_input" }],
    });
    const waiting = await session.call("send_message", { agentId: "bot-1", text: "go" });
    expect(JSON.parse(waiting.text).status).toBe("waiting_for_you_in_the_app");
  });

  it("needs exactly one target", async () => {
    const session = await connect(callerOf("talk"));
    const both = await session.call("send_message", {
      agentId: "bot-1",
      channelId: "group-1",
      text: "x",
    });
    const none = await session.call("send_message", { text: "x" });
    expect(both.isError).toBe(true);
    expect(none.isError).toBe(true);
  });
});

describe("what changes are attributed to", () => {
  it("marks tickets, comments and wiki pages as written through the key", async () => {
    const { client, raw } = fakeClient();
    const session = await connect(callerOf("configure"), { client });
    await session.call("create_ticket", { assigneeAgentId: "bot-1", title: "Invoices" });
    await session.call("comment_on_ticket", { ticketId: "t-1", body: "Looks right" });
    await session.call("write_wiki_page", { title: "Notes", body: "Body" });
    expect(raw.tickets.create.mock.calls[0]?.[0].description).toContain('via MCP key "laptop"');
    expect(raw.tickets.comment.mock.calls[0]?.[0].body).toContain('via MCP key "laptop"');
    const page = raw.wiki.write.mock.calls[0]?.[0];
    expect(page.body).toContain('via MCP key "laptop"');
    // A new page only: a page that exists is never replaced through a key.
    expect(page.expectedRevision).toBe(0);
  });

  it("records agent edits in the instruction history and changes only name, role and instructions", async () => {
    const { client, raw } = fakeClient();
    const session = await connect(callerOf("configure"), { client });
    await session.call("update_agent", {
      agentId: "bot-1",
      instructions: "Be brief.",
      approvalMode: "never",
      moneyCapPerCall: 1000,
    });
    const update = raw.bots.update.mock.calls[0]?.[0];
    expect(update).toEqual({
      botId: "bot-1",
      instructions: "Be brief.",
      reason: 'Changed via MCP key "laptop"',
    });
  });

  it("creates routines switched off and never switches one on", async () => {
    const { client, raw } = fakeClient();
    const session = await connect(callerOf("configure"), { client });
    await session.call("create_routine", {
      agentId: "bot-1",
      name: "Digest",
      prompt: "Summarize the day",
      crons: ["0 8 * * *"],
      active: true,
    });
    await session.call("update_routine", { routineId: "r-1", name: "Daily", active: true });
    expect(raw.routines.create.mock.calls[0]?.[0].active).toBe(false);
    expect(raw.routines.update.mock.calls[0]?.[0]).toEqual({ routineId: "r-1", name: "Daily" });
  });

  it("suggests a memory for the owner to save instead of saving it", async () => {
    const suggestMemory = vi.fn(async () => "created" as const);
    const session = await connect(callerOf("configure"), { deps: { suggestMemory } });
    const result = await session.call("remember", { text: "Prefers short answers" });
    expect(JSON.parse(result.text)).toEqual({ status: "waiting_for_owner" });
    expect(suggestMemory).toHaveBeenCalledWith(actorOf("space-a"), "Prefers short answers");
  });
});

describe("refusals from the app", () => {
  it("does not leak details of a forbidden call", async () => {
    const { ORPCError } = await import("@orpc/server");
    const { client } = fakeClient({
      bots: {
        list: async () => {
          throw new ORPCError("FORBIDDEN", { message: "internal detail about roles" });
        },
      },
    });
    const session = await connect(callerOf("read"), { client });
    const result = await session.call("list_agents");
    expect(result).toEqual({ isError: true, text: "You are not allowed to do that." });
  });
});
