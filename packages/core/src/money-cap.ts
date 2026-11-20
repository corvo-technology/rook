import type { ToolRisk } from "./tool-risk.js";
import { toolNameWords } from "./tool-risk.js";

/** The most an agent may move through payment tools. A missing limit means none. */
export type MoneyCap = { perCall: number | null; perMonth: number | null };

const MONEY_WORDS = new Set([
  "charge",
  "pay",
  "payment",
  "payments",
  "transfer",
  "refund",
  "payout",
  "purchase",
  "buy",
]);

/** The words of a tool name that mean moving money, for the database to prefilter on. */
export const MONEY_TOOL_WORDS = [...MONEY_WORDS];

/**
 * Whether a connector tool moves money: its name says so and it is not a read. Reading a charge or
 * listing payments moves nothing.
 */
export function toolMovesMoney(toolName: string, risk: ToolRisk): boolean {
  if (risk === "read") return false;
  const bare = toolName.startsWith("mcp__")
    ? toolName.split("__").slice(2).join("__") || toolName
    : toolName;
  return toolNameWords(bare).some((word) => MONEY_WORDS.has(word));
}

export function hasMoneyCap(cap: MoneyCap): boolean {
  return cap.perCall !== null || cap.perMonth !== null;
}

const AMOUNT_KEYS = new Set(["amount", "total", "value", "price", "sum"]);
const WRAPPER_KEYS = new Set(["payment", "data", "params", "body", "input", "arguments", "args"]);

function amountKeyScale(key: string): number | null {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  if (AMOUNT_KEYS.has(normalized)) return 1;
  if (/^(?:amount|total|price|unitamount)(?:in)?(?:cents|minor|minorunits)$/.test(normalized))
    return 0.01;
  if (normalized === "cents" || normalized === "unitamount") return 0.01;
  return null;
}

function numberFrom(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.abs(value) : null;
  if (typeof value === "string" && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value))
    return Math.abs(Number(value));
  return null;
}

/**
 * The amount a call moves, read from its arguments, or null when it names none or one it cannot
 * read. An `amount` is taken as written, so a cents amount reads as larger than it is and asks
 * earlier; keys that say cents or minor units are divided by 100. With several amounts the largest
 * counts.
 */
export function callAmount(args: unknown, depth = 0): number | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  let largest: number | null = null;
  for (const [key, value] of Object.entries(args)) {
    const scale = amountKeyScale(key);
    if (scale !== null) {
      const amount = numberFrom(value);
      // A named amount that cannot be read makes the whole call unreadable.
      if (amount === null) return null;
      largest = Math.max(largest ?? 0, amount * scale);
    } else if (depth < 1 && WRAPPER_KEYS.has(key.toLowerCase())) {
      const nested = callAmount(value, depth + 1);
      if (nested !== null) largest = Math.max(largest ?? 0, nested);
    }
  }
  return largest;
}

/** Whether a payment call runs on its own: `over` and `unreadable` both ask. */
export function moneyCapVerdict(input: {
  cap: MoneyCap;
  amount: number | null;
  spentThisMonth: number;
}): "within" | "over" | "unreadable" {
  if (!hasMoneyCap(input.cap)) return "within";
  if (input.amount === null) return "unreadable";
  const { perCall, perMonth } = input.cap;
  if (perCall !== null && input.amount > perCall) return "over";
  if (perMonth !== null && input.spentThisMonth + input.amount > perMonth) return "over";
  return "within";
}
