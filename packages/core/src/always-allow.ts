import { toolRequiresExplicitApproval } from "./action-approval.js";
import type { ToolRisk } from "./tool-risk.js";
import { toolNameWords } from "./tool-risk.js";

/** The kind of a kept "Always allow": one tool on one connection for one agent. */
export const SCOPED_RULE_KIND = "agent_tool";

/** What a kept rule covers. It never involves the call's params. */
export type RuleTarget = { tool: string; connection: string };

export type ScopedRule = RuleTarget & { id: string; botId: string };

/**
 * Words that mean merging, deploying, running anything, moving money or deleting, plus the
 * open-ended tools that can do any of it (raw SQL, GraphQL, HTTP proxies, shells). A call that
 * names one is only ever approved once.
 */
const LOCKED_WORDS = new Set([
  "merge",
  "deploy",
  "rollback",
  "release",
  "run",
  "execute",
  "exec",
  "invoke",
  "trigger",
  "commit",
  "pay",
  "payment",
  "payments",
  "charge",
  "purchase",
  "buy",
  "transfer",
  "refund",
  "payout",
  "delete",
  "remove",
  "destroy",
  "drop",
  "purge",
  "wipe",
  "sql",
  "graphql",
  "proxy",
  "http",
  "bash",
  "shell",
  "eval",
  "workbench",
]);

/** The built-in tools whose only effect is spending the agent's own budget. */
const ALWAYS_ALLOW_BUILTINS = new Set(["generate_image", "generate_video"]);

export type AlwaysAllowCandidate = RuleTarget & {
  /** A built-in tool, not one a connection provides. */
  builtin: boolean;
  /** MCP `destructiveHint`. */
  destructive?: boolean;
};

function offered(candidate: AlwaysAllowCandidate): boolean {
  if (toolRequiresExplicitApproval(candidate.tool)) return false;
  if (candidate.builtin) return ALWAYS_ALLOW_BUILTINS.has(candidate.tool);
  if (candidate.destructive === true) return false;
  return !toolNameWords(candidate.tool).some((word) => LOCKED_WORDS.has(word));
}

/**
 * What an "Always allow" on this call would cover, or null when none may be offered: a tool that
 * merges, deploys, runs anything, pays or deletes, a destructive or security-boundary tool, or
 * a batch with any such action. An empty call offers nothing.
 */
export function alwaysAllowTargets(
  candidates: readonly AlwaysAllowCandidate[],
): RuleTarget[] | null {
  if (candidates.length === 0 || !candidates.every(offered)) return null;
  return candidates.map(({ tool, connection }) => ({ tool, connection }));
}

/** The stored value of a rule: agent, connection and tool, lower case. */
export function scopedRuleValue(botId: string, target: RuleTarget): string {
  return `${botId}:${target.connection}:${target.tool}`.toLowerCase();
}

/** The rule for each target, or null when any target has none or a rule is for another agent. */
export function scopedRulesCover(
  rules: readonly ScopedRule[],
  botId: string,
  targets: readonly RuleTarget[],
): ScopedRule[] | null {
  const covering: ScopedRule[] = [];
  for (const target of targets) {
    const value = scopedRuleValue(botId, target);
    const rule = rules.find((candidate) => scopedRuleValue(candidate.botId, candidate) === value);
    if (!rule) return null;
    covering.push(rule);
  }
  return covering.length > 0 ? covering : null;
}

/**
 * Whether a kept rule may stand in for a card on this call. Never on a connection outside content
 * may have steered the run to, and never for a high-risk call (or one of unknown risk) once outside
 * content entered the run or when someone other than the owner started it: those still ask.
 */
export function scopedRuleMayApply(input: {
  risks: readonly ToolRisk[];
  tainted: boolean;
  ownerStartedRun: boolean;
  steeredConnector: boolean;
}): boolean {
  if (input.steeredConnector) return false;
  const high = input.risks.some((risk) => risk === "high" || risk === "unknown");
  return !(high && (input.tainted || !input.ownerStartedRun));
}

/** The connection a rule was given on, as a person names it; empty for the built-in tools. */
export function ruleConnectionLabel(target: RuleTarget): string {
  if (target.tool.startsWith("mcp__")) return target.tool.split("__")[1] || "mcp";
  if (target.connection === "builtin") return "";
  if (target.connection.startsWith("kind:")) return target.connection.split(":").pop() ?? "";
  return toolNameWords(target.tool)[0] ?? target.connection;
}

/** How many answers in a row, all "allow", before a card suggests keeping an always-allow. */
export const APPROVAL_LEARNING_STREAK = 3;

/** An approval card a person already answered, as kept on its effect. */
export type AnsweredApprovalCard = {
  targets: readonly RuleTarget[];
  answer: string;
  /** The card already suggested an always-allow. */
  suggested?: boolean;
};

function targetsKey(botId: string, targets: readonly RuleTarget[]): string {
  return targets
    .map((target) => scopedRuleValue(botId, target))
    .sort()
    .join("|");
}

/**
 * Whether this card should offer, once, to stop asking: the person allowed the same agent, tool
 * and connection the last few times without a deny in between, and no earlier card for it already
 * made the offer. Newest answers first.
 */
export function shouldSuggestAlways(
  botId: string,
  targets: readonly RuleTarget[],
  answered: readonly AnsweredApprovalCard[],
): boolean {
  const key = targetsKey(botId, targets);
  const same = answered.filter((card) => targetsKey(botId, card.targets) === key);
  if (same.some((card) => card.suggested)) return false;
  const recent = same.slice(0, APPROVAL_LEARNING_STREAK);
  return (
    recent.length === APPROVAL_LEARNING_STREAK &&
    recent.every((card) => card.answer === "allow" || card.answer === "always")
  );
}
