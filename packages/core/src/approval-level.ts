import type { ActionApprovalResolved, ApprovalMode } from "./action-approval.js";
import { planActionGate } from "./action-approval.js";

const MODES: readonly string[] = ["never", "auto", "risky", "always"];

/**
 * The mode a bot runs under: its own when it has one, else the default it follows. A stored value
 * that is not a known mode fails closed to Always ask, never to the default or to Never ask. A
 * stored "ask", from before Only what's risky existed, is that level.
 */
export function effectiveApprovalMode(
  botMode: string | null | undefined,
  defaultMode: ApprovalMode,
): ApprovalMode {
  if (botMode === null || botMode === undefined) return defaultMode;
  if (botMode === "ask") return "risky";
  return MODES.includes(botMode) ? (botMode as ApprovalMode) : "always";
}

/** What to store for a bot's choice: nothing when it is the mode the bot would follow anyway. */
export function storedBotApprovalMode(
  choice: ApprovalMode,
  defaultMode: ApprovalMode,
): ApprovalMode | null {
  return choice === defaultMode ? null : choice;
}

export type ApprovalSituation =
  | "read"
  | "change"
  | "lowRiskChange"
  | "allowedChange"
  | "askRuleChange"
  | "blockedChange"
  | "securityChange"
  | "steeredSecurityChange"
  | "steeredSecurityChangeNobodyThere"
  | "newSite"
  | "steeredRead";

type GateInput = Parameters<typeof planActionGate>[0];

const resolved = (
  decision: ActionApprovalResolved["decision"],
  source: ActionApprovalResolved["source"],
): ActionApprovalResolved => ({ decision, source, matchingRules: [] });
const unruled = resolved("allow", "default");

/** The situations a level is described by. Key order is the order of the union above. */
export const APPROVAL_SITUATIONS: Record<
  ApprovalSituation,
  Omit<GateInput, "mode" | "checkerConfigured">
> = {
  read: { resolved: unruled, consequential: false },
  change: { resolved: unruled, consequential: true },
  lowRiskChange: { resolved: unruled, consequential: true, lowRisk: true },
  allowedChange: { resolved: resolved("allow", "always_allow"), consequential: true },
  askRuleChange: { resolved: resolved("ask", "require_approval"), consequential: true },
  blockedChange: { resolved: resolved("deny", "deny"), consequential: true },
  securityChange: {
    resolved: unruled,
    consequential: true,
    mandatory: true,
    steerable: false,
  },
  steeredSecurityChange: {
    resolved: unruled,
    consequential: true,
    mandatory: true,
    steerable: true,
    ownerPresent: true,
  },
  steeredSecurityChangeNobodyThere: {
    resolved: unruled,
    consequential: true,
    mandatory: true,
    steerable: true,
    ownerPresent: false,
  },
  newSite: { resolved: unruled, consequential: true, newDestination: true },
  steeredRead: { resolved: unruled, consequential: false, reviewOnly: true },
};

export function approvalOutcomes(input: {
  mode: ApprovalMode;
  checkerConfigured: boolean;
}): Record<ApprovalSituation, "ask" | "allow" | "judge" | "deny"> {
  const outcomes = {} as Record<ApprovalSituation, "ask" | "allow" | "judge" | "deny">;
  for (const key of Object.keys(APPROVAL_SITUATIONS) as ApprovalSituation[]) {
    outcomes[key] = planActionGate({ ...APPROVAL_SITUATIONS[key], ...input });
  }
  return outcomes;
}

export type ApprovalSummary = "every_change" | "risky_only" | "reviewed" | "steered_only";

/** What still asks at a mode, read off the gate's verdict on an ordinary change. */
export function approvalModeSummary(input: {
  mode: ApprovalMode;
  checkerConfigured: boolean;
}): ApprovalSummary {
  const { change, lowRiskChange } = approvalOutcomes(input);
  if (change === "judge") return "reviewed";
  if (change === "allow") return "steered_only";
  return lowRiskChange === "allow" ? "risky_only" : "every_change";
}
