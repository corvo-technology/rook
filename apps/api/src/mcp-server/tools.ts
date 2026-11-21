import { randomUUID } from "node:crypto";
import type { Actor, McpAccessLevel, McpToolName, MessageBlock } from "@corvo/contracts";
import {
  BOT_INSTRUCTIONS_MAX_LENGTH,
  BOT_NAME_MAX_LENGTH,
  BOT_TITLE_MAX_LENGTH,
  MCP_TOOL_LEVELS,
  mcpLevelAllows,
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_MEMORY_TEXT_MAX,
  WIKI_BODY_MAX,
} from "@corvo/contracts";
import { getLogger } from "@corvo/logging";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ORPCError } from "@orpc/server";
import * as z from "zod";
import type { McpAppClient } from "./app-client.js";

/** Who is calling: one key, acting as the person who made it. */
export interface McpCaller {
  keyId: string;
  keyName: string;
  userId: string;
  level: McpAccessLevel;
  /** The one space the key is limited to, if any. */
  spaceId: string | null;
}

export interface McpAuditEntry {
  caller: McpCaller;
  spaceId: string | null;
  tool: McpToolName;
  /** An id that says what the call touched. Never a message, a title or any other content. */
  target: string | null;
  outcome: "ok" | "error";
}

export interface McpToolDeps {
  /** The app's own procedures as one actor: the same checks and row-level security as the app. */
  client(actor: Actor): McpAppClient;
  /** The actor for a space the caller may use; throws when the key or its owner may not. */
  actorFor(caller: McpCaller, spaceId: string | undefined): Promise<Actor>;
  /** Proposes a fact about the person; it waits for them to save it. */
  suggestMemory(actor: Actor, text: string): Promise<"created" | "known" | "forgotten">;
  audit(entry: McpAuditEntry): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** How a reply is waited for: how often the thread is read, and the longest anyone may wait. */
const POLL_MS = 1500;
const MAX_WAIT_SECONDS = 110;
const DEFAULT_WAIT_SECONDS = 30;
/** Longest message text returned in one piece. */
const TEXT_LIMIT = 4000;
const LIST_LIMIT = 100;
/** Statuses of a run that waits for a person rather than for work to finish. */
const WAITING_RUN_STATUSES = new Set(["waiting_input", "waiting_takeover"]);

class McpToolError extends Error {}

const space = z
  .string()
  .min(1)
  .optional()
  .describe("A space id from list_spaces. Leave out for the default space.");
const agentId = z.string().min(1).describe("An agent id from list_agents.");
const clip = (text: string, limit = TEXT_LIMIT) =>
  text.length > limit ? `${text.slice(0, limit)}…` : text;

/** What the text blocks of a message say, one after another. */
function textOf(blocks: readonly MessageBlock[]): string {
  return blocks
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
}

const viaKey = (caller: McpCaller) => `via MCP key "${caller.keyName}"`;
const attribution = (caller: McpCaller, text: string, limit: number) => {
  const note = `\n\n— ${viaKey(caller)}`;
  return `${text.slice(0, limit - note.length)}${note}`;
};

type ToolContext = { caller: McpCaller; actor: Actor; client: McpAppClient; deps: McpToolDeps };

interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  description: string;
  input: Shape;
  /** Whether the tool only reads, so a client may run it without asking. */
  readOnly: boolean;
  /** What the call touched, for the audit log. */
  target(args: z.infer<z.ZodObject<Shape>>): string | undefined;
  run(args: z.infer<z.ZodObject<Shape>>, context: ToolContext): Promise<unknown>;
}

function tool<Shape extends z.ZodRawShape>(definition: ToolDefinition<Shape>): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

const threadTarget = {
  agentId: z.string().min(1).optional().describe("An agent id, for a direct conversation."),
  channelId: z.string().min(1).optional().describe("A channel id from list_channels."),
};

function pickThread(args: { agentId?: string; channelId?: string }) {
  if (Boolean(args.agentId) === Boolean(args.channelId))
    throw new McpToolError("Give exactly one of agentId or channelId.");
  return args.agentId ? { botId: args.agentId } : { groupId: args.channelId as string };
}

export const MCP_TOOLS: Record<McpToolName, ToolDefinition> = {
  list_spaces: tool({
    description: "List the spaces you can reach.",
    input: {},
    readOnly: true,
    target: () => undefined,
    async run(_args, { caller, client }) {
      const { spaces } = await client.spaces.list();
      return spaces
        .filter((entry) => !caller.spaceId || entry.id === caller.spaceId)
        .map((entry) => ({ id: entry.id, name: entry.name, default: entry.isDefault }));
    },
  }),

  list_agents: tool({
    description: "List the agents in a space with their roles.",
    input: { space },
    readOnly: true,
    target: () => undefined,
    async run(_args, { client }) {
      const bots = await client.bots.list();
      return bots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        role: bot.title || bot.description,
        status: bot.status,
      }));
    },
  }),

  list_channels: tool({
    description: "List the channels in a space.",
    input: { space },
    readOnly: true,
    target: () => undefined,
    async run(_args, { client }) {
      const groups = await client.groups.list();
      return groups.map((group) => ({
        id: group.id,
        name: group.name,
        purpose: group.purpose,
        members: group.members.length,
      }));
    },
  }),

  list_threads: tool({
    description:
      "List the most recently active conversations: direct ones with agents and channels.",
    input: { space, limit: z.number().int().min(1).max(30).default(10) },
    readOnly: true,
    target: () => undefined,
    async run(args, { client }) {
      const [bots, groups] = await Promise.all([client.bots.list(), client.groups.list()]);
      return [
        ...bots.map((bot) => ({
          kind: "agent" as const,
          id: bot.id,
          name: bot.name,
          preview: clip(bot.preview, 200),
          updatedAt: bot.updatedAt,
        })),
        ...groups.map((group) => ({
          kind: "channel" as const,
          id: group.id,
          name: group.name,
          preview: clip(group.preview, 200),
          updatedAt: group.updatedAt,
        })),
      ]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, args.limit);
    },
  }),

  read_thread: tool({
    description:
      "Read the recent messages of a conversation. Pass afterSeq to read only what came after a message you sent.",
    input: {
      space,
      ...threadTarget,
      limit: z.number().int().min(1).max(50).default(20),
      afterSeq: z.number().int().min(0).optional(),
    },
    readOnly: true,
    target: (args) => args.agentId ?? args.channelId,
    async run(args, { client }) {
      const snapshot = await client.threads.get({ ...pickThread(args), preview: true });
      const messages = snapshot.messages
        .filter(
          (message) => !message.id.startsWith("progress:") && !message.id.startsWith("subagent:"),
        )
        .filter((message) => args.afterSeq === undefined || message.seq > args.afterSeq)
        .slice(-args.limit);
      return {
        running: (snapshot.activeRuns ?? []).length > 0,
        messages: messages.map((message) => ({
          seq: message.seq,
          from: message.role === "bot" ? "agent" : message.role,
          agentId: message.botId,
          author: message.authorName,
          text: clip(textOf(message.blocks)),
          at: message.createdAt,
        })),
      };
    },
  }),

  list_tickets: tool({
    description: "List tickets with their status.",
    input: {
      space,
      status: z.enum(TICKET_STATUSES).optional(),
      assigneeAgentId: z.string().min(1).optional(),
      query: z.string().trim().max(200).optional(),
    },
    readOnly: true,
    target: () => undefined,
    async run(args, { client }) {
      const { tickets } = await client.tickets.list({
        status: args.status,
        assigneeBotId: args.assigneeAgentId,
        q: args.query,
      });
      return tickets.slice(0, LIST_LIMIT).map((ticket) => ({
        id: ticket.id,
        ref: ticket.ref,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        assigneeAgentId: ticket.assigneeBotId,
        updatedAt: ticket.updatedAt,
      }));
    },
  }),

  get_ticket: tool({
    description: "Read one ticket with its comments, by id or by reference such as FIN-42.",
    input: {
      space,
      id: z.string().min(1).optional(),
      ref: z.string().min(1).optional(),
    },
    readOnly: true,
    target: (args) => args.id ?? args.ref,
    async run(args, { client }) {
      if (Boolean(args.id) === Boolean(args.ref))
        throw new McpToolError("Give exactly one of id or ref.");
      const ticket = await client.tickets.get(args.id ? { id: args.id } : { ref: args.ref });
      const comments = await client.tickets.comments({ ticketId: ticket.id });
      return {
        id: ticket.id,
        ref: ticket.ref,
        title: ticket.title,
        description: ticket.description === null ? null : clip(ticket.description),
        status: ticket.status,
        priority: ticket.priority,
        assigneeAgentId: ticket.assigneeBotId,
        comments: comments.slice(-30).map((comment) => ({
          author: comment.authorName,
          body: clip(comment.body, 1000),
          at: comment.createdAt,
        })),
      };
    },
  }),

  send_message: tool({
    description:
      "Send a message to an agent or a channel, as yourself. Waits for the reply up to waitSeconds; if the agent is still working, returns a handle to follow with read_thread. An agent that needs approval waits for you in the app.",
    input: {
      space,
      ...threadTarget,
      text: z.string().trim().min(1).max(8000),
      waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).default(DEFAULT_WAIT_SECONDS),
    },
    readOnly: false,
    target: (args) => args.agentId ?? args.channelId,
    async run(args, { client, deps }) {
      const target = pickThread(args);
      const sent = await client.threads.send({
        ...target,
        text: args.text,
        clientNonce: `mcp-${randomUUID()}`,
      });
      const runIds = sent.runIds ?? (sent.runId ? [sent.runId] : []);
      const handle = {
        ...(args.agentId ? { agentId: args.agentId } : { channelId: args.channelId }),
        afterSeq: sent.seq,
      };
      // A channel whose router picked nobody leaves the message standing with nothing to wait for.
      if (runIds.length === 0) return { status: "sent", replies: [], handle };
      if (args.waitSeconds === 0) return { status: "running", replies: [], handle };
      const deadline = deps.now() + args.waitSeconds * 1000;
      for (;;) {
        const snapshot = await client.threads.get({ ...target, preview: true });
        const mine = (snapshot.activeRuns ?? []).filter((run) => runIds.includes(run.id));
        if (mine.length === 0) {
          const replies = snapshot.messages
            .filter((message) => message.role === "bot" && message.seq > sent.seq)
            .filter(
              (message) =>
                !message.id.startsWith("progress:") && !message.id.startsWith("subagent:"),
            )
            .map((message) => ({
              agentId: message.botId,
              text: clip(textOf(message.blocks)),
              seq: message.seq,
            }))
            .filter((reply) => reply.text);
          return { status: "replied", replies, handle };
        }
        if (mine.some((run) => WAITING_RUN_STATUSES.has(run.status)))
          return { status: "waiting_for_you_in_the_app", replies: [], handle };
        if (deps.now() >= deadline) return { status: "running", replies: [], handle };
        await deps.sleep(POLL_MS);
      }
    },
  }),

  create_ticket: tool({
    description: "Create a ticket assigned to an agent.",
    input: {
      space,
      assigneeAgentId: agentId,
      title: z.string().trim().min(1).max(200),
      description: z
        .string()
        .max(TICKET_DESCRIPTION_MAX_LENGTH - 200)
        .optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
    },
    readOnly: false,
    target: (args) => args.assigneeAgentId,
    async run(args, { caller, client }) {
      const ticket = await client.tickets.create({
        title: args.title,
        assigneeBotId: args.assigneeAgentId,
        description: attribution(caller, args.description ?? "", TICKET_DESCRIPTION_MAX_LENGTH),
        ...(args.priority ? { priority: args.priority } : {}),
      });
      return { id: ticket.id, ref: ticket.ref, status: ticket.status };
    },
  }),

  comment_on_ticket: tool({
    description: "Add a comment to a ticket.",
    input: {
      space,
      ticketId: z.string().min(1),
      body: z
        .string()
        .trim()
        .min(1)
        .max(TICKET_COMMENT_MAX_LENGTH - 200),
    },
    readOnly: false,
    target: (args) => args.ticketId,
    async run(args, { caller, client }) {
      const comment = await client.tickets.comment({
        ticketId: args.ticketId,
        body: attribution(caller, args.body, TICKET_COMMENT_MAX_LENGTH),
      });
      return { id: comment.id };
    },
  }),

  create_agent: tool({
    description: "Create an agent with a name, a role and instructions.",
    input: {
      space,
      name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH),
      role: z.string().max(BOT_TITLE_MAX_LENGTH).optional(),
      instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH),
    },
    readOnly: false,
    target: () => undefined,
    async run(args, { client }) {
      const bot = await client.bots.create({
        name: args.name,
        title: args.role ?? "",
        instructions: args.instructions,
        // A greeting would spend a model turn nobody asked for.
        intro: false,
      });
      return { id: bot.id, name: bot.name };
    },
  }),

  update_agent: tool({
    description:
      "Change an agent's name, role or instructions. The change is recorded in the agent's instruction history as made through this key.",
    input: {
      space,
      agentId,
      name: z.string().trim().min(1).max(BOT_NAME_MAX_LENGTH).optional(),
      role: z.string().max(BOT_TITLE_MAX_LENGTH).optional(),
      instructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).optional(),
    },
    readOnly: false,
    target: (args) => args.agentId,
    async run(args, { caller, client }) {
      if (args.name === undefined && args.role === undefined && args.instructions === undefined)
        throw new McpToolError("Give a name, a role or instructions to change.");
      const bot = await client.bots.update({
        botId: args.agentId,
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.role !== undefined ? { title: args.role } : {}),
        ...(args.instructions !== undefined ? { instructions: args.instructions } : {}),
        reason: `Changed ${viaKey(caller)}`.slice(0, 200),
      });
      return { id: bot.id, name: bot.name };
    },
  }),

  create_routine: tool({
    description:
      "Create a routine: a prompt an agent runs on a schedule. It starts switched off; the owner turns it on in the app.",
    input: {
      space,
      agentId,
      name: z.string().trim().min(1).max(80),
      prompt: z.string().trim().min(1).max(8000),
      crons: z.array(z.string().min(1).max(100)).min(1).max(10).describe("Cron expressions."),
      timezone: z.string().min(1).max(80).optional().describe("An IANA zone such as Europe/Paris."),
    },
    readOnly: false,
    target: (args) => args.agentId,
    async run(args, { client }) {
      const routine = await client.routines.create({
        botId: args.agentId,
        name: args.name,
        prompt: args.prompt,
        crons: args.crons,
        ...(args.timezone ? { timezone: args.timezone } : {}),
        active: false,
      });
      return { id: routine.id, name: routine.name, active: routine.active };
    },
  }),

  update_routine: tool({
    description:
      "Change a routine's name, prompt or schedule. Switching it on stays with the owner.",
    input: {
      space,
      routineId: z.string().min(1),
      name: z.string().trim().min(1).max(80).optional(),
      prompt: z.string().trim().min(1).max(8000).optional(),
      crons: z.array(z.string().min(1).max(100)).min(1).max(10).optional(),
      timezone: z.string().min(1).max(80).optional(),
    },
    readOnly: false,
    target: (args) => args.routineId,
    async run(args, { client }) {
      const { routineId, space: _space, ...changes } = args;
      if (Object.values(changes).every((value) => value === undefined))
        throw new McpToolError("Give something to change.");
      const routine = await client.routines.update({ routineId, ...changes });
      return { id: routine.id, name: routine.name, active: routine.active };
    },
  }),

  remember: tool({
    description:
      "Suggest a short fact about the owner for their agents to remember. It waits in the app until the owner saves it.",
    input: { space, text: z.string().trim().min(1).max(USER_MEMORY_TEXT_MAX) },
    readOnly: false,
    target: () => undefined,
    async run(args, { actor, deps }) {
      const outcome = await deps.suggestMemory(actor, args.text);
      return { status: outcome === "created" ? "waiting_for_owner" : outcome };
    },
  }),

  write_wiki_page: tool({
    description:
      "Add a new page to the space's wiki. It never replaces a page that exists, and it is marked as written through this key.",
    input: {
      space,
      title: z.string().trim().min(1).max(120),
      body: z.string().max(WIKI_BODY_MAX - 200),
    },
    readOnly: false,
    target: () => undefined,
    async run(args, { caller, client }) {
      const page = await client.wiki.write({
        title: args.title,
        body: attribution(caller, args.body, WIKI_BODY_MAX),
        // 0 says the page must not exist yet.
        expectedRevision: 0,
      });
      return { title: page.title, revision: page.revision };
    },
  }),
};

/** What a failed call says to the client. Only the app's own refusals are repeated word for word. */
function failure(error: unknown): string {
  if (error instanceof McpToolError) return error.message;
  if (error instanceof ORPCError) {
    if (error.code === "FORBIDDEN" || error.code === "UNAUTHORIZED")
      return "You are not allowed to do that.";
    if (error.code === "NOT_FOUND") return "Not found.";
    if (error.code === "CONFLICT") return error.message || "That conflicts with what exists.";
    if (error.code === "BAD_REQUEST") return error.message || "The request was not valid.";
  }
  getLogger().error("mcp tool failed", error);
  return "Something went wrong.";
}

/** Whether the tool exists for a key of this level. */
export function mcpToolsFor(level: McpAccessLevel): McpToolName[] {
  return (Object.keys(MCP_TOOLS) as McpToolName[]).filter((name) =>
    mcpLevelAllows(level, MCP_TOOL_LEVELS[name]),
  );
}

/** Registers the tools this caller's level unlocks, and no others. */
export function registerMcpTools(server: McpServer, caller: McpCaller, deps: McpToolDeps): void {
  for (const name of mcpToolsFor(caller.level)) {
    const definition = MCP_TOOLS[name];
    server.registerTool(
      name,
      {
        description: definition.description,
        inputSchema: definition.input,
        annotations: { readOnlyHint: definition.readOnly, destructiveHint: false },
      },
      async (rawArgs: Record<string, unknown>) => {
        const args = rawArgs as { space?: string };
        let outcome: McpAuditEntry["outcome"] = "ok";
        let spaceId: string | null = null;
        try {
          const actor = await deps.actorFor(caller, args.space);
          spaceId = actor.spaceId;
          const result = await definition.run(rawArgs as never, {
            caller,
            actor,
            client: deps.client(actor),
            deps,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        } catch (error) {
          outcome = "error";
          return { isError: true, content: [{ type: "text" as const, text: failure(error) }] };
        } finally {
          await deps
            .audit({
              caller,
              spaceId,
              tool: name,
              target: definition.target(rawArgs as never) ?? null,
              outcome,
            })
            .catch(() => undefined);
        }
      },
    );
  }
}

export { McpToolError };
