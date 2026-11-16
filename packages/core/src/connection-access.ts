import { connectorToolIsRead } from "./action-approval.js";

/** What an agent may do with one connection. `custom` is shown for per-tool grants of older versions. */
export const ACCESS_LEVELS = ["none", "read", "write"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type StoredAccessLevel = Exclude<AccessLevel, "none">;
export type ConnectionKind = "mcp" | "database" | "mailbox";

/** The levels a kind of connection offers. A database is only ever read. */
export function accessLevelsFor(kind: ConnectionKind): readonly AccessLevel[] {
  return kind === "database" ? ["none", "read"] : ACCESS_LEVELS;
}

/** A stored level: a row without one predates levels and has full access; an unknown one is read. */
export function storedAccessLevel(value: string | null | undefined): StoredAccessLevel {
  return value === undefined || value === null || value === "write" ? "write" : "read";
}

/** What a grant row shows: an explicit tool list from an older version is `custom`. */
export function mcpGrantLevel(row: {
  allowAllTools: boolean;
  level: string | null | undefined;
}): StoredAccessLevel | "custom" {
  return row.allowAllTools ? storedAccessLevel(row.level) : "custom";
}

/**
 * Whether a server's tool is offered under a grant. A tool list from an older version decides on
 * its own; otherwise write offers every tool, now and later, and read only the reads.
 */
export function mcpToolOffered(
  grant: { allowAllTools: boolean; allowedTools: unknown; level: string | null | undefined },
  tool: { name: string; readOnly?: boolean },
): boolean {
  if (!grant.allowAllTools) {
    return Array.isArray(grant.allowedTools) && grant.allowedTools.includes(tool.name);
  }
  return (
    storedAccessLevel(grant.level) === "write" || connectorToolIsRead(tool.name, tool.readOnly)
  );
}

/** The mailbox tools that only look at mail. Drafting and sending need write. */
export const MAILBOX_READ_TOOLS: readonly string[] = ["search", "read"];

export function mailboxToolOffered(
  level: string | null | undefined,
  tool: "search" | "read" | "draft" | "send" | string,
): boolean {
  return storedAccessLevel(level) === "write" || MAILBOX_READ_TOOLS.includes(tool);
}
