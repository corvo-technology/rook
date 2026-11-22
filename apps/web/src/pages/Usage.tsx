import type { UsagePeriod } from "@corvo/contracts";
import { AgentLoader, Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { formatTokens } from "../lib/format-tokens";
import { useSpaceQueries } from "../lib/query";
import {
  formatUsd,
  usageActiveAgents,
  usageAgentKey,
  usageBars,
  usageChange,
  usageDayLabel,
  usageMetric,
  usageSpendTotal,
} from "../lib/usage-view";
import { errorText } from "../lib/user-error";
import { PlanUsageSection } from "./usage/plan-usage";
import { UsageChart } from "./usage/usage-chart";
import { AccountList, AgentList, SpendLead, TokenStats } from "./usage/usage-sections";

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
  const metric = overview ? usageMetric(overview) : "tokens";
  const bars = useMemo(
    () => usageBars(overview?.days ?? [], agent, metric),
    [overview, agent, metric],
  );
  const periods: Array<[UsagePeriod, string]> = [
    ["month", t`This month`],
    ["last-month", t`Last month`],
    ["30d", t`Last 30 days`],
  ];
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
  const valueText = (value: number) =>
    metric === "spend" ? formatUsd(value, locale) : tokensText(value);
  const billed = chosen?.cache ?? overview?.cache;
  const agents = useMemo(() => usageActiveAgents(overview?.agents ?? []), [overview]);

  let readout = "";
  const bar = hovered === null ? undefined : bars[hovered];
  if (bar) {
    const day = overview?.days[hovered ?? 0];
    const own =
      agent === null
        ? bar.value
        : metric === "spend"
          ? (day?.agentSpendUsd?.[agent] ?? 0)
          : (day?.agents[agent] ?? 0);
    readout = `${usageDayLabel(bar.date, locale)} · ${valueText(own)}`;
  } else if (chosen) {
    readout = `${agentName(chosen.name)} · ${valueText(metric === "spend" ? (chosen.spendUsd ?? 0) : chosen.tokens)}`;
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-10">
        <div className="mx-auto w-full max-w-3xl">
          <PageHeader
            flush
            actions={
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
            }
          >
            {t`Usage`}
          </PageHeader>

          <PlanUsageSection />

          {usage.error && !overview ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText(usage.error, t`Could not load`)}
            </p>
          ) : !overview ? (
            <AgentLoader size={32} />
          ) : (
            <>
              <section className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  {metric === "spend" && overview.spend ? (
                    <SpendLead spend={overview.spend} locale={locale} />
                  ) : (
                    <p className="text-[44px] font-medium leading-none tabular-nums tracking-tight">
                      {formatTokens(overview.tokens, locale)}
                      <span className="ms-2 text-base font-normal text-muted-foreground">
                        {t`tokens`}
                      </span>
                    </p>
                  )}
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
                  {overview.escalations ? (
                    <div>
                      <dt className="text-muted-foreground">{t`Escalated`}</dt>
                      <dd className="mt-0.5 text-[18px] font-medium tabular-nums">
                        {new Intl.NumberFormat(locale).format(overview.escalations)}
                      </dd>
                      {overview.requestedEscalations ? (
                        <dd className="text-muted-foreground">
                          {t`${new Intl.NumberFormat(locale).format(overview.requestedEscalations)} requested`}
                        </dd>
                      ) : null}
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
                      valueLabel={valueText}
                    />
                  </div>

                  {billed ? (
                    <section className="mt-10" aria-label={t`Tokens`}>
                      <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">
                        {chosen ? `${t`Tokens`} · ${agentName(chosen.name)}` : t`Tokens`}
                      </h2>
                      <TokenStats cache={billed} locale={locale} />
                    </section>
                  ) : null}

                  {agents.length > 0 ? (
                    <section className="mt-10" aria-label={t`By agent`}>
                      <h2 className="mb-1 text-[13px] font-medium text-muted-foreground">{t`By agent`}</h2>
                      <AgentList
                        agents={agents}
                        total={metric === "spend" ? usageSpendTotal(overview) : overview.tokens}
                        selected={agent}
                        onSelect={setAgent}
                        agentName={agentName}
                        budgetOf={budgetOf}
                        budgetLine={budgetLine}
                        spendMode={metric === "spend"}
                      />
                    </section>
                  ) : null}

                  {overview.accounts?.length ? (
                    <section className="mt-10" aria-label={t`By model`}>
                      <h2 className="mb-1 text-[13px] font-medium text-muted-foreground">{t`By model`}</h2>
                      <AccountList accounts={overview.accounts} />
                    </section>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
