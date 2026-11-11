import type { UsagePeriod } from "@corvo/contracts";
import { normalizeRunError } from "@corvo/core";
import { BotAvatar, Button, Progress, Spinner } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { formatTokens } from "../lib/context-meter";
import { useSpaceQueries } from "../lib/query";
import { translateRunError } from "../lib/run-error";
import {
  usageAgentKey,
  usageBars,
  usageChange,
  usageDayLabel,
  usageShare,
} from "../lib/usage-view";
import { errorText } from "../lib/user-error";
import { UsageChart } from "./usage/usage-chart";
import { WindowChrome } from "./WindowChrome";

/** What the account has run, by day and by agent, for the month or the last thirty days. */
export function UsagePage() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const queries = useSpaceQueries();
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const [agent, setAgent] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const usage = useQuery({
    ...queries.usage.overview.queryOptions({ input: { period } }),
    placeholderData: keepPreviousData,
  });
  const overview = usage.data;
  const budgets = useQuery(queries.usage.budgets.queryOptions());
  const budgetLine = (budget: { monthTokens: number; monthlyTokenLimit: number }) => {
    const used = new Intl.NumberFormat(locale).format(budget.monthTokens);
    const limit = new Intl.NumberFormat(locale).format(budget.monthlyTokenLimit);
    return t`${used} of ${limit}`;
  };
  const budgetOf = (id: string | null) => budgets.data?.find((budget) => budget.botId === id);
  const bars = useMemo(() => usageBars(overview?.days ?? [], agent), [overview, agent]);
  const periods: Array<[UsagePeriod, string]> = [
    ["month", t`This month`],
    ["last-month", t`Last month`],
    ["30d", t`Last 30 days`],
  ];
  const currency = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  const change = overview ? usageChange(overview) : null;
  const versus =
    period === "month"
      ? t`vs. the same days last month`
      : period === "last-month"
        ? t`vs. the month before`
        : t`vs. the 30 days before`;
  const chosen = overview?.agents.find((item) => usageAgentKey(item.id) === agent);
  const agentName = (name: string) => name || t`Deleted agent`;
  const tokensText = (tokens: number) => {
    const count = formatTokens(tokens, locale);
    return t`${count} tokens`;
  };
  const failedText = (failed: number, topError?: string | null) => {
    const count = new Intl.NumberFormat(locale).format(failed);
    const failures = t`${count} failed`;
    return topError
      ? `${failures}: ${normalizeRunError(topError, translateRunError, locale).summary}`
      : failures;
  };
  const avgText = (seconds: number) => {
    const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
      seconds >= 60 ? seconds / 60 : seconds,
    );
    return seconds >= 60 ? t`${value} min avg` : t`${value} s avg`;
  };
  const repliesText = (replies: number) => {
    const count = new Intl.NumberFormat(locale).format(replies);
    return t`${count} replies`;
  };

  let readout = "";
  const bar = hovered === null ? undefined : bars[hovered];
  if (bar) {
    const day = overview?.days[hovered ?? 0];
    const tokens = agent === null ? bar.tokens : (day?.agents[agent] ?? 0);
    readout = `${usageDayLabel(bar.date, locale)} · ${tokensText(tokens)}`;
  } else if (chosen) {
    readout = `${agentName(chosen.name)} · ${tokensText(chosen.tokens)}`;
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="app-drag flex items-center gap-2 px-4 pt-3">
        <WindowChrome />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-10">
        <div className="mx-auto w-full max-w-3xl">
          <header className="flex flex-wrap items-center justify-between gap-3 py-4">
            <h1 className="text-base font-medium">{t`Usage`}</h1>
            <div className="flex gap-1">
              {periods.map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={period === value ? "secondary" : "ghost"}
                  aria-pressed={period === value}
                  onClick={() => {
                    setPeriod(value);
                    setAgent(null);
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
          </header>

          {usage.error && !overview ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText(usage.error, t`Could not load`)}
            </p>
          ) : !overview ? (
            <Spinner />
          ) : (
            <>
              <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <p className="text-[44px] font-medium leading-none tabular-nums tracking-tight">
                    {formatTokens(overview.tokens, locale)}
                    <span className="ms-2 text-base font-normal text-muted-foreground">
                      {t`tokens`}
                    </span>
                  </p>
                  {change !== null ? (
                    <p className="mt-2 text-[13px] text-muted-foreground">
                      <span className="tabular-nums text-foreground">
                        {new Intl.NumberFormat(locale, {
                          style: "percent",
                          maximumFractionDigits: 0,
                          signDisplay: "exceptZero",
                        }).format(change)}
                      </span>{" "}
                      {versus}
                    </p>
                  ) : null}
                </div>
                <dl className="flex gap-6 text-[13px]">
                  <div>
                    <dt className="text-muted-foreground">{t`Replies`}</dt>
                    <dd className="mt-0.5 text-[18px] font-medium tabular-nums">
                      {new Intl.NumberFormat(locale).format(overview.replies)}
                    </dd>
                  </div>
                  {overview.costUsd ? (
                    <div>
                      <dt className="text-muted-foreground">{t`Cost`}</dt>
                      <dd className="mt-0.5 text-[18px] font-medium tabular-nums">
                        {overview.costUsd < 0.01 ? "<" : ""}
                        {currency.format(Math.max(overview.costUsd, 0.01))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>

              {overview.tokens === 0 ? (
                <p className="mt-10 text-sm text-muted-foreground">{t`No use in this period.`}</p>
              ) : (
                <>
                  <div className="mt-8">
                    <UsageChart
                      bars={bars}
                      locale={locale}
                      readout={readout}
                      onHover={setHovered}
                      tokensLabel={tokensText}
                    />
                  </div>

                  <section className="mt-10" aria-label={t`By agent`}>
                    <h2 className="mb-1 text-[13px] font-medium text-muted-foreground">{t`By agent`}</h2>
                    <ul className="m-0 list-none p-0">
                      {overview.agents.map((item) => {
                        const key = usageAgentKey(item.id);
                        const share = usageShare(item.tokens, overview.tokens);
                        const selected = agent === key;
                        const model = item.models[0];
                        const budget = budgetOf(item.id);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setAgent(selected ? null : key)}
                              className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2.5 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
                            >
                              {item.color ? (
                                <BotAvatar color={item.color} identity={key} size={28} />
                              ) : (
                                <span className="size-7 rounded-lg bg-muted" aria-hidden="true" />
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">
                                  {agentName(item.name)}
                                </span>
                                <span className="block truncate text-[12.5px] text-muted-foreground">
                                  {[
                                    model?.model,
                                    repliesText(item.replies),
                                    item.avgSeconds != null ? avgText(item.avgSeconds) : undefined,
                                    item.failed
                                      ? failedText(item.failed, item.topError)
                                      : undefined,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </span>
                              <span className="text-end">
                                <span className="block text-sm tabular-nums">
                                  {formatTokens(item.tokens, locale)}
                                </span>
                                <span className="block text-[12.5px] tabular-nums text-muted-foreground">
                                  {new Intl.NumberFormat(locale, {
                                    style: "percent",
                                    maximumFractionDigits: 0,
                                  }).format(share)}
                                </span>
                              </span>
                              {overview.agents.length > 1 ? (
                                <span
                                  className="col-span-3 mt-2 block h-[3px] overflow-hidden rounded-full bg-foreground/10"
                                  aria-hidden="true"
                                >
                                  <span
                                    className="block h-full rounded-full bg-foreground/80"
                                    style={{ width: `${share * 100}%` }}
                                  />
                                </span>
                              ) : null}
                            </button>
                            {budget ? (
                              <div className="px-2 pb-2.5">
                                <Progress
                                  aria-label={t`Monthly token limit`}
                                  value={Math.min(
                                    100,
                                    Math.round(
                                      (budget.monthTokens / budget.monthlyTokenLimit) * 100,
                                    ),
                                  )}
                                  className="gap-1"
                                >
                                  <span className="text-[12.5px] tabular-nums text-muted-foreground">
                                    {budgetLine(budget)}
                                  </span>
                                </Progress>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
