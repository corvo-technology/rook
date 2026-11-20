/**
 * How risky one connector tool is, from its name and the effect hints its provider declared.
 *
 * - `read`: looks at something and changes nothing.
 * - `low`: changes something inside the connection that can be undone (create, update, label).
 * - `high`: reaches outside the product or cannot be undone (send, post, pay, delete, merge, deploy,
 *   run anything), or the provider marked it destructive. A hint never lowers this.
 * - `unknown`: matches nothing, or contradicts itself. It asks like a high-risk tool.
 */
export type ToolRisk = "read" | "low" | "high" | "unknown";

export type ToolRiskHints = {
  /** MCP `readOnlyHint`, or the method of an installed API. `false` is a declared write. */
  readOnly?: boolean;
  /** MCP `destructiveHint`. */
  destructive?: boolean;
  /** The built-in partner connection's own call, whose reads are numbers about the organization. */
  fromPartnerConnector?: boolean;
};

const READ_VERBS = new Set([
  "get",
  "list",
  "search",
  "find",
  "read",
  "fetch",
  "query",
  "describe",
  "view",
  "show",
  "check",
  "lookup",
  "count",
  "preview",
  "download",
  "export",
  "whoami",
  "suggest",
  "status",
]);

const LOW_RISK_VERBS = new Set([
  "create",
  "update",
  "add",
  "set",
  "tag",
  "label",
  "move",
  "rename",
  "archive",
  "draft",
  "schedule",
  "upsert",
  "modify",
  "patch",
  "put",
  "mark",
  "assign",
  "unassign",
  "copy",
  "close",
  "reopen",
  "edit",
  "append",
  "insert",
]);

/** Verbs that mean an effect outside the product, money, deletion or open-ended execution. */
const LOCKED_VERBS = new Set([
  "send",
  "reply",
  "forward",
  "publish",
  "pay",
  "buy",
  "refund",
  "payout",
  "delete",
  "remove",
  "destroy",
  "purge",
  "wipe",
  "deploy",
  "rollback",
  "execute",
  "invoke",
]);

/**
 * Locked words that are also ordinary nouns (a post, a commit, a run). They lock a name, except
 * as the thing a leading read verb looks at: `get_commit`, `list_posts`, `get_run`.
 */
const LOCKED_NOUNISH_WORDS = new Set([
  "post",
  "share",
  "invite",
  "charge",
  "purchase",
  "transfer",
  "drop",
  "merge",
  "release",
  "run",
  "trigger",
  "commit",
  "payment",
  "payments",
]);

const COMPOUND_WORDS = new Set(["and", "or", "then"]);

/** A tool name as lowercase words: snake, kebab, dotted, camel and upper case all split alike. */
export function toolNameWords(toolName: string): string[] {
  return toolName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

const PARTNER_WRITE_TOOLS = new Set([
  "partner_add_credit",
  "partner_pause_customer",
  "partner_resume_customer",
  "partner_set_customer_limit",
]);
const PARTNER_READ_TOOLS = new Set([
  "partner_list_customers",
  "partner_customer_usage",
  "partner_attention",
  "partner_revenue_summary",
  "partner_invoices",
]);

/** What the name alone says. The first verb decides, unless a word locks the name outright. */
function riskFromName(toolName: string): ToolRisk {
  const words = toolNameWords(toolName);
  const compound = words.slice(1, -1).some((word) => COMPOUND_WORDS.has(word));
  const lockedVerb = words.some((word) => LOCKED_VERBS.has(word));
  const lockedNoun = words.some((word) => LOCKED_NOUNISH_WORDS.has(word));
  if (lockedVerb) return "high";
  if (compound) return lockedNoun ? "high" : "low";
  const at = words.findIndex(
    (word) => READ_VERBS.has(word) || LOW_RISK_VERBS.has(word) || LOCKED_NOUNISH_WORDS.has(word),
  );
  if (at < 0) return "unknown";
  const verb = words[at] as string;
  if (READ_VERBS.has(verb)) {
    // Only the word right after the read verb is read as its object.
    const rest = [...words.slice(0, at), ...words.slice(at + 2)];
    return rest.some((word) => LOCKED_NOUNISH_WORDS.has(word)) ? "high" : "read";
  }
  if (LOCKED_NOUNISH_WORDS.has(verb) || lockedNoun) return "high";
  return "low";
}

/** An MCP tool is named `mcp__<server>__<tool>`: the server's own name says nothing about the tool. */
function bareToolName(toolName: string): string {
  if (!toolName.startsWith("mcp__")) return toolName;
  return toolName.split("__").slice(2).join("__") || toolName;
}

export function classifyConnectorTool(toolName: string, hints: ToolRiskHints = {}): ToolRisk {
  if (PARTNER_WRITE_TOOLS.has(toolName)) return "high";
  if (hints.destructive === true) return "high";
  if (hints.fromPartnerConnector && hints.readOnly === true && PARTNER_READ_TOOLS.has(toolName)) {
    return "read";
  }
  const fromName = riskFromName(bareToolName(toolName));
  if (fromName === "high") return "high";
  if (hints.readOnly === true) return "read";
  if (hints.readOnly === false) return fromName === "read" ? "unknown" : fromName;
  return fromName;
}
