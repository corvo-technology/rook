import type { ActionApprovalRule as StoredActionApprovalRule } from "@corvo/contracts";
import type { ToolRisk, ToolRiskHints } from "./tool-risk.js";
import { classifyConnectorTool } from "./tool-risk.js";

const APPROVAL_EXEMPT_TOOLS = new Set([
  "computer_observe",
  "computer_act",
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
  "list_files",
  "read_file",
  "read_history",
  "read_result",
  "search_history",
  "write_file",
  "shell",
  "open_path",
  "launch_app",
  "remember",
  "remember_about_user",
  "recall_about_user",
  "request_takeover",
  "request_secret",
  "generate_secret",
  "run_subagent",
  "spawn_bot",
  "schedule_create",
  "schedule_list",
  "schedule_update",
  "schedule_cancel",
  "notify_priority",
  "notify_control",
  "workflow_stop",
  "pass",
  "note_surfaced",
  "list_fleet",
  "guide_read",
  "space_status",
  "organize_bot",
]);

const APPROVAL_REQUIRED_BUILTIN_TOOLS = new Set([
  "generate_image",
  "generate_video",
  "delete_bot",
  "archive_bot",
  "secret_request",
  "forget_secret",
  "forget_memory",
  "cloud_agent_launch",
  "cloud_agent_reply",
  "cloud_agent_cancel",
]);
const EXPLICIT_APPROVAL_BUILTIN_TOOLS = new Set([
  "propose_agent",
  "respond_agent_connection",
  "create_space",
  "propose_instructions_update",
  "create_group",
  "update_group",
  "set_child_instructions",
  "set_child_bot_model",
  "create_child_routine",
  "add_routine_step",
]);

const UNATTENDED_SAFE_BUILTIN_TOOLS = new Set([
  "browser_snapshot",
  "cloud_agent_status",
  "research_start",
  "research_status",
  "computer_observe",
  "list_files",
  "list_fleet",
  "guide_read",
  "find_in_app",
  "space_status",
  "list_secrets",
  "read_file",
  "recall_memory",
  "recall_about_user",
  "wiki_index",
  "wiki_search",
  "wiki_read",
  "read_document",
  "request_takeover",
  "run_subagent",
  "task_catalog",
  "schedule_list",
  "scratchpad_list",
  "skill_read",
  "store_skills",
  "web_fetch",
  "web_search",
  "notify_priority",
  "workflow_stop",
  "pass",
  "note_surfaced",
]);

/**
 * The partner connection's own tools. Its reads are numbers and states of the organization's
 * portfolio; its writes move credit or stop a customer, so they ask a person every time, whatever
 * the access level, the approval mode or an allow rule. A read is exempt from the name check only
 * when the call comes from that built-in connection (see `connectorToolRequiresApproval`): the
 * same name from any other source still asks.
 */
const PARTNER_READ_CONNECTOR_TOOLS = new Set([
  "partner_list_customers",
  "partner_customer_usage",
  "partner_attention",
  "partner_revenue_summary",
  "partner_invoices",
]);
const PARTNER_WRITE_CONNECTOR_TOOLS = new Set([
  "partner_add_credit",
  "partner_pause_customer",
  "partner_resume_customer",
  "partner_set_customer_limit",
]);

const READ_ONLY_CONNECTOR_PATTERN = /(^|_)(get|list|search|find|read)(_|$)/i;
const MUTATING_CONNECTOR_PATTERN =
  /(^|_)(accept|add|approve|archive|assign|buy|cancel|charge|checkout|close|commit|copy|create|delete|deploy|disable|enable|execute|forward|grant|invite|link|mark|merge|modify|move|patch|pay|post|publish|purchase|put|register|reject|remove|rename|replace|reply|reset|revoke|run|schedule|send|set|share|start|stop|submit|subscribe|trigger|unassign|unlink|unsubscribe|update|upload|upsert|write)(_|$)/i;
const COMPOUND_CONNECTOR_ACTION_PATTERN = /_(and|or|then)_/i;

const EMAIL_CONNECTOR_SLUGS = new Set(["gmail", "outlook", "microsoft_outlook", "mailbox"]);
const PURCHASE_CONNECTOR_SLUGS = new Set(["stripe", "shopify", "paypal", "square"]);

export type ActionApprovalRule = Pick<
  StoredActionApprovalRule,
  "effect" | "matchKind" | "matchValue"
> & { id?: string };

export function connectorKindFromToolName(toolName: string, connectorKinds: string[] = []): string {
  const normalizedTool = toolName.toLowerCase();
  const matched = connectorKinds
    .map((kind) => kind.toLowerCase())
    .filter((kind) => normalizedTool === kind || normalizedTool.startsWith(`${kind}_`))
    .sort((left, right) => right.length - left.length)[0];
  if (matched) return matched;
  const [segment] = toolName.split("_");
  return (segment ?? toolName).toLowerCase();
}

/** True when the tool's name reads as a write or as a compound of actions. */
export function connectorToolNamedAsWrite(toolName: string): boolean {
  return (
    MUTATING_CONNECTOR_PATTERN.test(toolName) || COMPOUND_CONNECTOR_ACTION_PATTERN.test(toolName)
  );
}

/** The connector tool's declared effect. A hint never lowers a tool the name locks as high risk. */
export type ConnectorToolHints = Omit<ToolRiskHints, "fromPartnerConnector">;

/**
 * The risk of a connector tool (see `classifyConnectorTool`). `fromPartnerConnector` is true only
 * for the built-in partner connection, whose reads are exempt; the same name from any other source
 * is classified like any other tool.
 */
export function connectorToolRisk(
  toolName: string,
  readOnly?: boolean,
  fromPartnerConnector = false,
  destructive?: boolean,
): ToolRisk {
  return classifyConnectorTool(toolName, { readOnly, destructive, fromPartnerConnector });
}

/**
 * Whether the tool is consequential: anything but a read asks at "Always ask". The provider chooses
 * both the name and the hints, so neither a read name nor a read-only hint relaxes a locked name,
 * and a declared write or destructive tool is never a read.
 */
export function connectorToolRequiresApproval(
  toolName: string,
  readOnly?: boolean,
  fromPartnerConnector = false,
  destructive?: boolean,
): boolean {
  return connectorToolRisk(toolName, readOnly, fromPartnerConnector, destructive) !== "read";
}

/** Whether a tool may be granted at read level: it is classified as a read. */
export function connectorToolIsRead(
  toolName: string,
  readOnly?: boolean,
  destructive?: boolean,
): boolean {
  return connectorToolRisk(toolName, readOnly, false, destructive) === "read";
}

/**
 * Unattended runs keep the strict name check: a declared read never relaxes it, and only
 * `get`, `list`, `search`, `find` and `read` between underscores count as reads.
 */
function unattendedConnectorToolRequiresApproval(
  toolName: string,
  readOnly?: boolean,
  fromPartnerConnector = false,
): boolean {
  if (readOnly === false || PARTNER_WRITE_CONNECTOR_TOOLS.has(toolName)) return true;
  if (fromPartnerConnector && readOnly === true && PARTNER_READ_CONNECTOR_TOOLS.has(toolName)) {
    return false;
  }
  if (connectorToolNamedAsWrite(toolName)) return true;
  return !READ_ONLY_CONNECTOR_PATTERN.test(toolName);
}

/** Unattended watches require explicit read-only metadata and must respect approval rules. */
export function watchToolRefusal(input: {
  toolName: string;
  readOnly?: boolean;
  connectorKind?: string;
  rules: ActionApprovalRule[];
}): string | null {
  const { toolName, readOnly } = input;
  if (readOnly !== true) {
    return `${toolName} can change data, so a change trigger can't run it. Pick a read-only tool.`;
  }
  const decision = resolveActionApprovalDetail({
    toolName,
    connectorKind: input.connectorKind,
    readOnly,
    rules: input.rules,
  }).decision;
  if (decision === "deny") return `${toolName} is blocked, so a change trigger can't run it.`;
  if (decision === "ask") {
    return `${toolName} needs approval under this space's rules, and a change check cannot ask.`;
  }
  return null;
}

export function toolRequiresApproval(
  toolName: string,
  viaConnector: boolean,
  readOnly?: boolean,
  fromPartnerConnector = false,
  destructive?: boolean,
  /** The risk once a classifier weighed in (see applyToolClassification); else from name and hints. */
  risk?: ToolRisk,
): boolean {
  if (APPROVAL_EXEMPT_TOOLS.has(toolName)) return false;
  if (toolRequiresExplicitApproval(toolName)) return true;
  if (APPROVAL_REQUIRED_BUILTIN_TOOLS.has(toolName)) return true;
  if (viaConnector) {
    if (risk !== undefined) return risk !== "read";
    return connectorToolRequiresApproval(toolName, readOnly, fromPartnerConnector, destructive);
  }
  return false;
}

/** Security-boundary changes cannot be auto-reviewed or permanently allowed. */
export function toolRequiresExplicitApproval(toolName: string): boolean {
  return (
    EXPLICIT_APPROVAL_BUILTIN_TOOLS.has(toolName) || PARTNER_WRITE_CONNECTOR_TOOLS.has(toolName)
  );
}

/**
 * A run the owner started: their own message, a follow-up they wrote, or the close of their call.
 * Bot messages, channels, spawns, tickets, webhooks and routines are not, nor is anything new.
 */
export function isOwnerStartedRun(trigger: string, followUpFromUser: boolean): boolean {
  if (trigger === "follow_up") return followUpFromUser;
  return trigger === "user" || trigger === "call_end";
}

/** External webhook runs may inspect state unattended, but side effects always need the owner. */
export function unattendedTriggerToolRequiresApproval(
  trigger: string,
  toolName: string,
  viaConnector: boolean,
  readOnly?: boolean,
): boolean {
  if (trigger !== "webhook") return false;
  return viaConnector
    ? unattendedConnectorToolRequiresApproval(toolName, readOnly)
    : !UNATTENDED_SAFE_BUILTIN_TOOLS.has(toolName);
}

/**
 * Tools whose results bring in nothing from outside during the run: confirmations of the bot's own
 * writes, the owner's answers, and the product's own saved state (memory, skills, history), which
 * is treated like the conversation already in context. Every other result (pages, search hits,
 * files, connector data, the screen, shell output, other bots) can carry text an attacker wrote,
 * and taints the run. New tools taint by default.
 */
const OWN_STATE_RESULT_TOOLS = new Set([
  "notify_priority",
  "notify_control",
  "ask_user",
  "connect_app",
  "propose_host_action",
  "attach_file",
  "end_call",
  "generate_secret",
  "install_agent",
  "find_in_app",
  "list_fleet",
  "guide_read",
  "list_secrets",
  "message_user",
  "say_now",
  "react_to_message",
  "read_history",
  "recall_memory",
  "remember",
  "render_plot",
  "request_secret",
  "save_memory",
  "save_shared_memory",
  "schedule_cancel",
  "schedule_create",
  "schedule_list",
  "schedule_update",
  "scratchpad_add",
  "scratchpad_complete",
  "scratchpad_list",
  "scratchpad_remove",
  "scratchpad_update",
  "search_history",
  "skill_read",
  "skill_install",
  "store_skills",
  "plan_set",
  "plan_update",
  "store_agents",
  "list_routines",
  "task_catalog",
  "write_file",
]);

export function toolResultTaintsRun(toolName: string): boolean {
  return !OWN_STATE_RESULT_TOOLS.has(toolName);
}

/**
 * A connector read still sends its arguments to the connector's server. Until outside content
 * enters the run, those arguments come from the owner's request. After that, injected text could
 * choose them, so a read skips approval only on a connector this run already used before then or
 * was approved for. Reads on that connector stay free, so list-then-get flows never ask twice.
 */
export function connectorReadRequiresApproval(input: {
  tainted: boolean;
  connectorTrusted: boolean;
}): boolean {
  return input.tainted && !input.connectorTrusted;
}

/**
 * web_fetch sends its whole URL, query string included, to the site it names, so a site this run
 * was not given is a new destination that injected text could have picked. Trusted sites (named in
 * the owner's own words, approved earlier in the run, or the exact URL of a search result) and
 * sites with an always-allow rule go through. In Only what's risky so does any other site unless
 * outside text could have chosen a URL that can carry data. Anything else is new: planActionGate decides who
 * judges it, and newSiteOutcome what happens when nobody passed it.
 */
export function outboundSiteGate(input: {
  site: string;
  trusted: boolean;
  rules: ActionApprovalRule[];
  /**
   * Only what's risky, the mode that does not ask before reading a website. In it a new site is
   * not a destination worth asking about while its URL cannot have been chosen by outside text:
   * the run is clean (so the URL came from the owner or the model), or the URL carries no data.
   */
  mode?: ApprovalMode;
  tainted?: boolean;
  /** The URL has a query, a fragment or a path that could hold data (see urlMayCarryData). */
  carriesData?: boolean;
}): "allow" | "new" {
  if (input.trusted || siteAlwaysAllowed(input.rules, input.site)) return "allow";
  if (input.mode === "risky" && (!input.tainted || !input.carriesData)) return "allow";
  return "new";
}

/**
 * A new site that Auto Review did not pass needs a person. A webhook run has nobody to ask, so
 * there it is refused.
 */
export function newSiteOutcome(input: {
  trigger: string;
  decision: "ask" | "allow";
}): "ask" | "allow" | "deny" {
  if (input.decision === "allow") return "allow";
  return input.trigger === "webhook" ? "deny" : "ask";
}

export function siteAlwaysAllowed(rules: ActionApprovalRule[], site: string): boolean {
  return rules.some(
    (rule) =>
      rule.effect === "always_allow" &&
      rule.matchKind === "site" &&
      rule.matchValue.toLowerCase() === site,
  );
}

function categoryMatches(
  category: string,
  toolName: string,
  connectorKind: string,
  readOnly: boolean | undefined,
): boolean {
  const normalized = category.toLowerCase();
  const consequential = connectorToolRequiresApproval(toolName, readOnly);
  if (normalized === "email") {
    if (EMAIL_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /send.*mail|gmail_send|outlook_send/i.test(toolName);
  }
  if (normalized === "purchase") {
    if (PURCHASE_CONNECTOR_SLUGS.has(connectorKind.toLowerCase())) return consequential;
    return consequential && /purchase|pay_|charge|checkout|buy_/i.test(toolName);
  }
  return false;
}

/**
 * These run code inside Composio that can call any action, so a block scoped to one action could
 * be routed around through them. Any block that is not for a site matches them.
 */
const COMPOSIO_CODE_TOOLS = new Set(["composio_remote_workbench", "composio_remote_bash_tool"]);

function ruleMatches(
  rule: ActionApprovalRule,
  toolName: string,
  connectorKind: string,
  readOnly: boolean | undefined,
  site: string | undefined,
): boolean {
  if (
    rule.effect === "deny" &&
    rule.matchKind !== "site" &&
    COMPOSIO_CODE_TOOLS.has(toolName.toLowerCase())
  ) {
    return true;
  }
  const value = rule.matchValue.toLowerCase();
  switch (rule.matchKind) {
    case "site":
      return site === value;
    case "tool":
      return toolName.toLowerCase() === value;
    case "connector":
      return connectorKind.toLowerCase() === value;
    case "category":
      return categoryMatches(rule.matchValue, toolName, connectorKind, readOnly);
    default:
      return false;
  }
}

function ruleSpecificity(rule: ActionApprovalRule): number {
  switch (rule.matchKind) {
    case "site":
      return 4;
    case "tool":
      return 3;
    case "connector":
      return 2;
    case "category":
      return 1;
    default:
      return 0;
  }
}

export type ActionApprovalSource = "require_approval" | "always_allow" | "deny" | "default";

export type ActionApprovalResolved = {
  decision: "ask" | "allow" | "deny";
  source: ActionApprovalSource;
  matchingRules: ActionApprovalRule[];
};

/**
 * Deterministic rule resolution. A block always wins, so a narrower allow cannot punch through it.
 * Otherwise the most specific rule decides, and `site`, the destination of an outbound fetch,
 * beats a rule for the tool.
 */
export function resolveActionApprovalDetail(input: {
  toolName: string;
  connectorKind?: string;
  readOnly?: boolean;
  site?: string;
  rules: ActionApprovalRule[];
}): ActionApprovalResolved {
  const connectorKind = input.connectorKind ?? connectorKindFromToolName(input.toolName);
  const matchingRules = input.rules.filter((rule) =>
    ruleMatches(rule, input.toolName, connectorKind, input.readOnly, input.site),
  );
  if (matchingRules.length === 0) {
    return { decision: "allow", source: "default", matchingRules };
  }
  if (matchingRules.some((rule) => rule.effect === "deny")) {
    return { decision: "deny", source: "deny", matchingRules };
  }

  const highestSpecificity = Math.max(...matchingRules.map(ruleSpecificity));
  const winners = matchingRules.filter((rule) => ruleSpecificity(rule) === highestSpecificity);
  if (winners.some((rule) => rule.effect === "require_approval")) {
    return { decision: "ask", source: "require_approval", matchingRules };
  }
  return { decision: "allow", source: "always_allow", matchingRules };
}

export function resolveActionApproval(input: {
  toolName: string;
  connectorKind?: string;
  readOnly?: boolean;
  rules: ActionApprovalRule[];
}): "ask" | "allow" | "deny" {
  return resolveActionApprovalDetail(input).decision;
}

/** Composio sends every batch of actions through this one tool, naming each in `tools[].tool_slug`. */
export const COMPOSIO_MULTI_EXECUTE_TOOL = "COMPOSIO_MULTI_EXECUTE_TOOL";

/**
 * The actions a Composio batch runs, or undefined when the call is not a batch. `complete` is false
 * when an entry names no action: nothing can show what it does, so the call must ask.
 */
export function composioBatchActions(
  toolName: string,
  args: unknown,
): { slugs: string[]; complete: boolean } | undefined {
  if (toolName !== COMPOSIO_MULTI_EXECUTE_TOOL) return undefined;
  const tools = args && typeof args === "object" ? (args as { tools?: unknown }).tools : undefined;
  if (!Array.isArray(tools)) return undefined;
  const slugs = new Set<string>();
  let complete = tools.length > 0;
  for (const item of tools) {
    const slug =
      item && typeof item === "object" ? (item as { tool_slug?: unknown }).tool_slug : undefined;
    if (typeof slug === "string" && slug.trim()) slugs.add(slug.trim());
    else complete = false;
  }
  return { slugs: [...slugs], complete };
}

/**
 * Rules for every action one call runs. The strictest action decides, so one allowed action never
 * carries the rest of a batch, and the batch is allowed by rule only when each action is. `wrapper`
 * can only block: a block on the batch tool itself or its connector still stops every batch.
 */
export function resolveActionApprovalForTools(input: {
  tools: ReadonlyArray<{ name: string; connectorKind?: string; readOnly?: boolean }>;
  wrapper?: { name: string; connectorKind?: string };
  site?: string;
  rules: ActionApprovalRule[];
}): ActionApprovalResolved {
  const resolve = (tool: { name: string; connectorKind?: string; readOnly?: boolean }) =>
    resolveActionApprovalDetail({
      toolName: tool.name,
      connectorKind: tool.connectorKind,
      readOnly: tool.readOnly,
      site: input.site,
      rules: input.rules,
    });
  const parts = input.tools.map(resolve);
  const wrapper = input.wrapper ? resolve(input.wrapper) : undefined;
  if (wrapper?.decision === "deny") parts.push(wrapper);
  const matchingRules = [...new Set(parts.flatMap((part) => part.matchingRules))];
  const strictest =
    parts.find((part) => part.decision === "deny") ?? parts.find((part) => part.decision === "ask");
  if (strictest) return { ...strictest, matchingRules };
  const allAllowed = parts.length > 0 && parts.every((part) => part.source === "always_allow");
  return { decision: "allow", source: allAllowed ? "always_allow" : "default", matchingRules };
}

/**
 * How much a space asks before acting. `never` runs everything without waiting, `auto` lets the
 * approval model pass what fits the owner's request, `risky` asks only before actions that reach
 * outside the product or cannot be undone, and `always` asks before anything that changes something.
 */
export type ApprovalMode = "never" | "auto" | "risky" | "always";

/**
 * The mode a stored preference means. Skipping approvals is Never ask, an enabled review is Auto,
 * and `alwaysAsk` is Always ask. A preference that chose none of them, which includes every one
 * saved when Ask was the only level, is Only what's risky.
 */
export function approvalModeFromPreference(preference: {
  enabled: boolean;
  skipApprovals: boolean;
  alwaysAsk?: boolean;
}): ApprovalMode {
  if (preference.skipApprovals) return "never";
  if (preference.enabled) return "auto";
  return preference.alwaysAsk ? "always" : "risky";
}

export function approvalPreferenceFromMode(mode: ApprovalMode): {
  enabled: boolean;
  skipApprovals: boolean;
  alwaysAsk: boolean;
} {
  return {
    enabled: mode === "auto",
    skipApprovals: mode === "never",
    alwaysAsk: mode === "always",
  };
}

export type AutoReviewJudgeDecision = "pass" | "ask" | "error";

/**
 * The gate after rule resolution. A block refuses in every mode. An approval a person must give
 * asks, except in Never ask, which never waits: there it runs when the owner started the run and no
 * outside content entered it. Otherwise outside text could have asked for it, so it asks the owner
 * when they started the run and is refused when nobody is there to answer. Otherwise Never ask
 * runs it, an ask rule asks, and anything that would ask goes to the approval model in Auto,
 * falling back to asking when no model is set up.
 */
export function planActionGate(input: {
  resolved: ActionApprovalResolved;
  mode: ApprovalMode;
  /** Needs a person whatever the rules say (see toolRequiresExplicitApproval). */
  mandatory?: boolean;
  /** The owner did not start this run, or outside content entered it. */
  steerable?: boolean;
  /** The owner started this run and no outside message reached it, so a card can go to them. */
  ownerPresent?: boolean;
  consequential: boolean;
  /**
   * The call is an undoable change inside a connection (see `ToolRisk`). Only what's risky lets it
   * run; it stays false when outside content may have chosen it.
   */
  lowRisk?: boolean;
  /**
   * A read whose arguments outside content may have chosen (see connectorReadRequiresApproval).
   * It goes to a connection the owner set up, so only the approval model checks it.
   */
  reviewOnly?: boolean;
  checkerConfigured: boolean;
  /** A fetch to a site the run was not given (see outboundSiteGate). */
  newDestination?: boolean;
  /**
   * A payment over the agent's money cap, or one whose amount cannot be read (see
   * moneyCapVerdict). A rule, a level or the approval model never lets it run unasked.
   */
  overMoneyCap?: boolean;
}): "ask" | "allow" | "judge" | "deny" {
  const plan = planGateWithoutCap(input);
  return input.overMoneyCap && plan !== "deny" ? "ask" : plan;
}

function planGateWithoutCap(
  input: Parameters<typeof planActionGate>[0],
): "ask" | "allow" | "judge" | "deny" {
  if (input.resolved.decision === "deny") return "deny";
  if (input.mandatory) {
    if (input.mode !== "never") return "ask";
    if (!input.steerable) return "allow";
    return input.ownerPresent ? "ask" : "deny";
  }
  if (input.mode === "never") return "allow";
  if (input.resolved.decision === "ask") return "ask";
  // Only auto judges; risky and always ask, and risky first lets an undoable change through.
  const review = input.mode === "auto" && input.checkerConfigured ? "judge" : "ask";
  // A rule for the whole tool is not a choice of sites, so it never allows a new one; only a site
  // rule does, and that makes the site no longer new. The approval model judges a new site on the
  // owner's own words and the full URL: it never sees tool results or inbound messages, so text
  // injected there cannot argue for the site.
  if (input.newDestination) return review;
  if (input.resolved.source === "always_allow") return "allow";
  if (input.consequential) return input.mode === "risky" && input.lowRisk ? "allow" : review;
  return input.reviewOnly && review === "judge" ? "judge" : "allow";
}

/** Map a judge outcome onto ask/allow. Errors fail closed on consequential tools. */
export function applyJudgeDecision(input: {
  decision: AutoReviewJudgeDecision;
  consequential: boolean;
}): "ask" | "allow" {
  if (input.decision === "pass") return "allow";
  if (input.decision === "ask") return "ask";
  return input.consequential ? "ask" : "allow";
}

/**
 * The Markdown characters an approval card title escapes in the names it shows, as a regular
 * expression character class. Web renders the title as Markdown; plain-text surfaces unescape them.
 */
export const CARD_TITLE_ESCAPED_CHARACTERS = "[\\\\`*_[\\]<>~|]";

export function isSecretAskBlock(block: {
  kind: string;
  input?: string;
  approvalEffectId?: string;
}): boolean {
  return block.kind === "ask" && block.input === "secret" && !block.approvalEffectId;
}

/** How long the allow button of an action approval is held before the approval counts. */
export const HOLD_TO_APPROVE_MS = 800;

/**
 * Whether this action of an approval card is approved by holding it: the plain "allow" of an
 * action a tool is about to run. A proposed change, an instruction update and a space creation
 * stay a tap, since holding adds nothing where nothing leaves the product.
 */
export function holdsToApprove(
  card: { approval: boolean; proposal?: boolean; instructionUpdate?: boolean },
  action: { id: string; outcome?: string },
): boolean {
  return (
    card.approval &&
    !card.proposal &&
    !card.instructionUpdate &&
    action.id === "allow" &&
    !action.outcome
  );
}

export function asksHoldToApprove(
  block: {
    kind: string;
    approvalEffectId?: string;
    actions?: readonly { id: string; label: string }[];
    proposal?: true;
    instructionUpdate?: unknown;
  },
  action: { id: string; outcome?: string },
): boolean {
  return holdsToApprove(
    {
      approval: isApprovalAskBlock(block),
      proposal: block.proposal,
      instructionUpdate: Boolean(block.instructionUpdate),
    },
    action,
  );
}

export function isApprovalAskBlock(block: {
  kind: string;
  approvalEffectId?: string;
  actions?: readonly { id: string; label: string }[];
}): boolean {
  if (block.kind !== "ask" || !block.approvalEffectId || !block.actions?.length) return false;
  const actionIds = new Set(block.actions.map((action) => action.id));
  return (
    actionIds.has("allow") &&
    actionIds.has("deny") &&
    [...actionIds].every((id) => id === "allow" || id === "always" || id === "deny")
  );
}
