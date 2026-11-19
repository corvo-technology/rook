import type { Bot, PartnerQuickAction } from "@corvo/contracts";

export type EmbedTabId = "home" | "chats" | "board" | "routines" | "team";

export const EMBED_TAB_PATHS: Record<EmbedTabId, string> = {
  home: "/app/home",
  chats: "/app",
  board: "/app/board",
  routines: "/app/routines",
  team: "/app/team",
};

/** Which tabs the frame shows: the five areas, minus what the partner hides or the account lacks. */
export function embedTabs(input: {
  hidden: readonly string[];
  ticketBoardEnabled: boolean;
}): EmbedTabId[] {
  const { hidden, ticketBoardEnabled } = input;
  return [
    "home",
    "chats",
    ...(ticketBoardEnabled && !hidden.includes("board") ? (["board"] as const) : []),
    ...(hidden.includes("routines") ? [] : (["routines"] as const)),
    "team",
  ];
}

/** The tab a path belongs to; every chat, group and person is under Conversas. */
export function activeEmbedTab(pathname: string): EmbedTabId {
  if (pathname.startsWith("/app/home")) return "home";
  if (pathname.startsWith("/app/board")) return "board";
  if (pathname.startsWith("/app/routines")) return "routines";
  if (pathname.startsWith("/app/team")) return "team";
  return "chats";
}

/**
 * The Home shortcuts: the template's own, or, for a template that sets none, the first starter of
 * each agent other than the Chief.
 */
export function quickActions(
  partner: { quickActions?: readonly PartnerQuickAction[] } | null | undefined,
  bots: readonly Pick<Bot, "id" | "starters">[],
  chiefId: string | undefined,
): PartnerQuickAction[] {
  if (partner?.quickActions?.length) return [...partner.quickActions];
  return bots
    .filter((bot) => bot.id !== chiefId)
    .flatMap((bot) => (bot.starters?.[0] ? [bot.starters[0]] : []))
    .slice(0, 4)
    .map((starter) => ({ label: starter, prompt: starter }));
}

export interface PartnerBalance {
  currency: string;
  planCredit: number;
  used: number;
  remaining: number;
  periodEnd: string | null;
  state: string;
  checkoutUrl: string | null;
  buyInApp?: boolean;
  lowThresholdReached: boolean;
}

/** Reads the balance an in-app RPC returned; null for anything that is not that shape. */
export function parsePartnerBalance(value: unknown): PartnerBalance | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const whole = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  if (
    typeof v.currency !== "string" ||
    !whole(v.planCredit) ||
    !whole(v.used) ||
    !whole(v.remaining)
  ) {
    return null;
  }
  return {
    currency: v.currency,
    planCredit: v.planCredit as number,
    used: v.used as number,
    remaining: v.remaining as number,
    periodEnd: typeof v.periodEnd === "string" ? v.periodEnd : null,
    state: typeof v.state === "string" ? v.state : "active",
    checkoutUrl: typeof v.checkoutUrl === "string" ? v.checkoutUrl : null,
    ...(v.buyInApp === true ? { buyInApp: true } : {}),
    lowThresholdReached: v.lowThresholdReached === true,
  };
}

export type BalanceView = {
  kind: "normal" | "low" | "empty" | "lapsed";
  remaining: string;
  total: string;
  ratio: number;
} | null;

/** Minor units as the partner's money, without cents when there are none. */
export function formatMinor(minor: number, currency: string, locale: string): string {
  const major = minor / 100;
  const whole = Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major}`;
  }
}

/** What the balance line shows; nothing when the server has no balance to give. */
export function balanceView(balance: PartnerBalance | null, locale: string): BalanceView {
  if (!balance || balance.planCredit <= 0) return null;
  const remaining = Math.max(0, balance.remaining);
  const lapsed = balance.state === "lapsed" || balance.state === "inactive";
  const kind = lapsed
    ? "lapsed"
    : remaining === 0
      ? "empty"
      : balance.lowThresholdReached
        ? "low"
        : "normal";
  return {
    kind,
    remaining: formatMinor(remaining, balance.currency, locale),
    total: formatMinor(balance.planCredit, balance.currency, locale),
    ratio: Math.min(1, remaining / balance.planCredit),
  };
}
