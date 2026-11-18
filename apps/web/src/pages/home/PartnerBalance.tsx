import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { openCheckout } from "../../lib/embed";
import type { PartnerBalance as Balance } from "../../lib/embedded-home";
import { balanceView, parsePartnerBalance } from "../../lib/embedded-home";
import { rpc } from "../../lib/rpc";

/**
 * The partner's balance, when the server offers one. A server without the call answers with an
 * error and the line is simply not there; nothing is retried.
 */
export function usePartnerBalance(): Balance | null {
  const query = useQuery({
    queryKey: ["billing", "partnerBalance"],
    queryFn: async () => {
      const client = rpc as unknown as { billing?: { partnerBalance?: () => Promise<unknown> } };
      return parsePartnerBalance(await client.billing?.partnerBalance?.());
    },
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  return query.data ?? null;
}

/** How much of the month's credit is left, a warning near the end, and the way to buy more. */
export function PartnerBalanceLine({
  balance,
  locale,
}: {
  balance: Balance | null;
  locale: string;
}) {
  const { t } = useLingui();
  const view = balanceView(balance, locale);
  if (!balance || !view) return null;
  const { remaining, total } = view;
  const warn = view.kind !== "normal";
  const note =
    view.kind === "lapsed"
      ? t`Plan inactive`
      : view.kind === "empty"
        ? t`Used up`
        : view.kind === "low"
          ? t`Running low`
          : null;
  return (
    <div
      data-testid="partner-balance"
      data-state={view.kind}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium tabular-nums">{t`${remaining} of ${total} this month`}</span>
          {note ? (
            <span
              data-testid="partner-balance-note"
              className={view.kind === "low" ? "text-warning" : "text-destructive"}
            >
              {note}
            </span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(view.ratio * 100)}
          aria-label={t`${remaining} of ${total} this month`}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={`h-full origin-left rounded-full transition-transform duration-700 ease-out ${
              view.kind === "low" ? "bg-warning" : warn ? "bg-destructive" : "bg-primary"
            }`}
            style={{ transform: `scaleX(${view.ratio})` }}
          />
        </div>
      </div>
      {balance.checkoutUrl ? (
        <button
          type="button"
          data-testid="partner-buy-more"
          onClick={() => openCheckout(balance.checkoutUrl as string)}
          className={`h-9 rounded-full px-4 text-sm font-medium outline-none transition-transform duration-150 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring ${
            warn
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-background hover:bg-muted"
          }`}
        >
          {t`Buy more`}
        </button>
      ) : null}
    </div>
  );
}
