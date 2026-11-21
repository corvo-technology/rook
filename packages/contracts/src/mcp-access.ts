import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/**
 * What an MCP access key may do, each level including the one before it: `read` lists and reads,
 * `talk` also messages agents and works tickets, `configure` also edits agents, routines and notes.
 */
export const MCP_ACCESS_LEVELS = ["read", "talk", "configure"] as const;
export const McpAccessLevelSchema = z.enum(MCP_ACCESS_LEVELS);
export type McpAccessLevel = z.infer<typeof McpAccessLevelSchema>;

/** A key starts with this, so a pasted secret is recognizable and scanners can find a leak. */
export const MCP_KEY_PREFIX = "rk_";

/** Most active keys one person may hold. */
export const MCP_KEYS_MAX = 20;

/**
 * Every tool the MCP endpoint offers and the level that unlocks it. This table is the whole
 * surface: nothing deletes, decides an approval, touches people or secrets, or loosens an
 * approval rule, because no tool for those exists.
 */
export const MCP_TOOL_LEVELS = {
  list_spaces: "read",
  list_agents: "read",
  list_channels: "read",
  list_threads: "read",
  read_thread: "read",
  list_tickets: "read",
  get_ticket: "read",
  send_message: "talk",
  create_ticket: "talk",
  comment_on_ticket: "talk",
  create_agent: "configure",
  update_agent: "configure",
  create_routine: "configure",
  update_routine: "configure",
  remember: "configure",
  write_wiki_page: "configure",
} as const satisfies Record<string, McpAccessLevel>;
export type McpToolName = keyof typeof MCP_TOOL_LEVELS;

/** Whether a key of `held` level may use a tool that needs `required`. */
export function mcpLevelAllows(held: McpAccessLevel, required: McpAccessLevel): boolean {
  return MCP_ACCESS_LEVELS.indexOf(held) >= MCP_ACCESS_LEVELS.indexOf(required);
}

export const McpAccessKeyNameSchema = z.string().trim().min(1).max(60);

export const McpAccessKeySchema = z.object({
  id: Id,
  name: z.string(),
  level: McpAccessLevelSchema,
  /** The one space the key is limited to; null reaches every space of its owner. */
  spaceId: Id.nullable(),
  spaceName: z.string().nullable(),
  /** The first characters of the key, to tell keys apart. The rest is never stored. */
  prefix: z.string(),
  createdAt: IsoDate,
  lastUsedAt: IsoDate.nullable(),
  revokedAt: IsoDate.nullable(),
});
export type McpAccessKey = z.infer<typeof McpAccessKeySchema>;

export const McpAccessKeyCreateInputSchema = z.object({
  name: McpAccessKeyNameSchema,
  level: McpAccessLevelSchema,
  spaceId: Id.optional(),
});
export type McpAccessKeyCreateInput = z.infer<typeof McpAccessKeyCreateInputSchema>;

export const McpAccessKeyCreatedSchema = z.object({
  key: McpAccessKeySchema,
  /** The whole key. It is shown once, here, and never again. */
  secret: z.string(),
});
export type McpAccessKeyCreated = z.infer<typeof McpAccessKeyCreatedSchema>;
