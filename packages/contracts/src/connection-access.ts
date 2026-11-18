import { z } from "zod";
import { Id } from "./ids.js";

export const CONNECTION_KINDS = ["mcp", "database", "mailbox", "partner"] as const;
export const ConnectionKindSchema = z.enum(CONNECTION_KINDS);
export type ConnectionKind = z.infer<typeof ConnectionKindSchema>;

/** The one "Partnership" connection an organization with a partner has; agents are lent it like any. */
export const PARTNER_CONNECTION_ID = "partner";

/** A level someone can choose. A database only offers `none` and `read`. */
export const AccessLevelSchema = z.enum(["none", "read", "write"]);

/** One agent's access to one connection. An agent with none has no entry. */
export const ConnectionAccessSchema = z.object({
  kind: ConnectionKindSchema,
  connectionId: Id,
  botId: Id,
  /** `custom` is a per-tool list set by an older version; it stays until someone picks a level. */
  level: z.enum(["read", "write", "custom"]),
});
export type ConnectionAccess = z.infer<typeof ConnectionAccessSchema>;

export const ConnectionAccessSetInput = z.object({
  kind: ConnectionKindSchema,
  connectionId: Id,
  botIds: z.array(Id).min(1).max(500),
  level: AccessLevelSchema,
});
