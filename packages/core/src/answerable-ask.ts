import { isApprovalAskBlock, isSecretAskBlock } from "./action-approval.js";

type AskSnapshot = {
  messages: readonly {
    id: string;
    runId?: string | null;
    blocks: readonly { kind: string; status?: string; input?: string; approvalEffectId?: string }[];
  }[];
  run?: { id: string; status: string; userId?: string } | null;
  activeRuns?: readonly { id: string; status: string; userId?: string }[];
};

export function answerableAskMessageIds(snapshot: AskSnapshot | null): Set<string> {
  const answerable = new Set<string>();
  if (!snapshot) return answerable;
  const waitingRunIds = new Set(
    (snapshot.activeRuns ?? (snapshot.run ? [snapshot.run] : []))
      .filter((run) => run.status === "waiting_input")
      .map((run) => run.id),
  );
  for (const message of snapshot.messages) {
    if (!message.runId || !waitingRunIds.has(message.runId)) continue;
    if (message.blocks.some((block) => block.kind === "ask" && block.status !== "answered")) {
      answerable.add(message.id);
    }
  }
  return answerable;
}

/** Secret requests can only be dismissed by the user of their run. */
export function dismissableAskMessageIds(
  snapshot: AskSnapshot | null,
  userId?: string,
): Set<string> {
  const dismissable = new Set<string>();
  if (!snapshot || !userId) return dismissable;
  const runs = snapshot.activeRuns ?? (snapshot.run ? [snapshot.run] : []);
  const ownedRunIds = new Set(
    runs
      .filter((run) => run.status === "waiting_input" && run.userId === userId)
      .map((run) => run.id),
  );
  for (const message of snapshot.messages) {
    if (
      message.runId &&
      ownedRunIds.has(message.runId) &&
      message.blocks.some((block) => isSecretAskBlock(block) && block.status !== "answered")
    ) {
      dismissable.add(message.id);
    }
  }
  return dismissable;
}

export function selectedAskActionLabel(
  answer: string,
  actions?: readonly { id: string; label: string }[],
): string {
  return resolveAskChoice(answer, actions)?.label ?? answer;
}

export function resolveAskChoice(
  answer: string,
  actions?: readonly { id: string; label: string }[],
): { id: string; label: string } | undefined {
  if (!actions?.length) return undefined;
  const trimmed = answer.trim();
  if (!trimmed) return undefined;
  const byId = actions.find((action) => action.id === trimmed);
  if (byId) return byId;
  const lower = trimmed.toLowerCase();
  return actions.find((action) => action.label.trim().toLowerCase() === lower);
}

/** Most approvals one batch decides, so a single request stays bounded. */
export const APPROVAL_BATCH_MAX = 20;

export type ApprovalBatchClass = "tool" | "site";

type BatchableBlock = {
  kind: string;
  status?: string;
  approvalEffectId?: string;
  proposal?: boolean;
  instructionUpdate?: unknown;
  input?: string;
  site?: string;
  actions?: readonly { id: string; label: string; outcome?: string }[];
};

/**
 * The safety class an approval card can be decided in with others, or null when it must be decided
 * alone: secret inputs, instruction updates, proposals and anything that creates or cancels
 * something. A card with no "always" choice is a security-boundary change, so it never batches. A
 * site fetch is its own class, never mixed with tool calls.
 */
export function approvalBatchClass(block: BatchableBlock): ApprovalBatchClass | null {
  if (!isApprovalAskBlock(block) || block.status === "answered") return null;
  if (block.proposal || block.instructionUpdate || block.input === "secret") return null;
  if (block.actions?.some((action) => action.outcome)) return null;
  if (!block.actions?.some((action) => action.id === "always")) return null;
  return block.site ? "site" : "tool";
}

export type ApprovalBatchItem = { messageId: string; runId: string; approvalEffectId: string };

/** Pending approvals the viewer can answer, grouped by safety class; only groups of two or more. */
export function pendingApprovalBatches(
  messages: readonly {
    id: string;
    runId?: string | null;
    blocks: readonly BatchableBlock[];
  }[],
  answerable: ReadonlySet<string>,
): { batchClass: ApprovalBatchClass; items: ApprovalBatchItem[] }[] {
  const groups = new Map<ApprovalBatchClass, ApprovalBatchItem[]>();
  for (const message of messages) {
    if (!message.runId || !answerable.has(message.id)) continue;
    for (const block of message.blocks) {
      const batchClass = approvalBatchClass(block);
      if (!batchClass || !block.approvalEffectId) continue;
      const items = groups.get(batchClass) ?? [];
      items.push({
        messageId: message.id,
        runId: message.runId,
        approvalEffectId: block.approvalEffectId,
      });
      groups.set(batchClass, items);
    }
  }
  return [...groups]
    .filter(([, items]) => items.length >= 2)
    .map(([batchClass, items]) => ({ batchClass, items: items.slice(0, APPROVAL_BATCH_MAX) }));
}
