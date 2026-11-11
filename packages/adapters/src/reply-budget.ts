import {
  BOT_REPLY_CAP_RUN_ERROR,
  REPLY_CAP_OVERRUN,
  REPLY_CAP_REFUSED_CALLS,
  replyCap,
} from "@corvo/core";

/** What one run (all its attempts, subagents and calls) may spend, and what it has. */
export interface ReplyBudget {
  cap: number;
  spent: number;
  refused: number;
  over: boolean;
  cut: boolean;
}

/** Read by the model, not shown as UI. */
export const REPLY_CAP_TOOL_REFUSAL =
  "This reply reached its token cap. Do not call more tools. Write in a few lines what you did, what you found and what is left, then end the turn.";

/** Thrown to end a reply that kept spending after its cap. */
export class ReplyCapExceededError extends Error {
  constructor() {
    super(BOT_REPLY_CAP_RUN_ERROR);
    this.name = "ReplyCapExceededError";
  }
}

export function createReplyBudget(limit: number | null, spentBefore: number): ReplyBudget {
  const budget: ReplyBudget = {
    cap: replyCap(limit),
    spent: 0,
    refused: 0,
    over: false,
    cut: false,
  };
  addReplyUsage(budget, spentBefore);
  return budget;
}

export function addReplyUsage(budget: ReplyBudget, tokens: number): void {
  budget.spent += tokens;
  if (budget.spent > budget.cap) budget.over = true;
  if (budget.spent > budget.cap * REPLY_CAP_OVERRUN) budget.cut = true;
}

/** Null while under the cap; past it, counts the refusal and says to wrap up. */
export function refuseToolAtCap(budget: ReplyBudget): { error: string } | null {
  if (!budget.over) return null;
  budget.refused += 1;
  if (budget.refused > REPLY_CAP_REFUSED_CALLS) budget.cut = true;
  return { error: REPLY_CAP_TOOL_REFUSAL };
}
