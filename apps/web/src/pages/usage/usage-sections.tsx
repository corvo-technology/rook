import type { UsageAccount, UsageCache, UsageFailureKind, UsageOverview } from "@corvo/contracts";
import { BotAvatar, Progress } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { formatTokens } from "../../lib/context-meter";
import {
  formatUsd,
  usageAgentKey,
  usageFailureKinds,
  usageFold,
  usageHitRate,
} from "../../lib/usage-view";

type Agent = UsageOverview["agents"][number];

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  mistral: "Mistral",
  xai: "xAI",
};

/** The "+N" button under a folded list; it reveals the rest and goes away. */
function MoreButton({ count, onClick }: { count: number; onClick: () => void }) {
  const { t, i18n } = useLingui();
  const shown = new Intl.NumberFormat(i18n.locale || "en").format(count);
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 rounded-lg px-2 py-2 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {t`${shown} more`}
    </button>
  );
}

function useFormats() {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const cached = (cache: UsageCache | undefined) => {
    const rate = cache ? usageHitRate(cache) : null;
    if (!rate) return undefined;
    const share = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(rate);
    return t`${share} cached`;
  };
  return { locale, number, cached };
}

/** What a failed run was about, in a few words. */
export function useFailureLabel() {
  const { t } = useLingui();
  const labels: Record<UsageFailureKind, string> = {
    billing: t`Billing`,
    limit: t`Limit reached`,
    computer: t`Computer did not start`,
    error: t`Error`,
  };
  return (kind: UsageFailureKind) => labels[kind];
}

/** The money spent, led by the total and split by who paid. */
export function SpendLead({
  spend,
  locale,
}: {
  spend: NonNullable<UsageOverview["spend"]>;
  locale: string;
}) {
  const { t } = useLingui();
  const total = spend.creditsUsd + spend.ownUsd;
  const estimated = spend.ownEstimatedUsd > 0;
  return (
    <div>
      <p className="text-[44px] font-medium leading-none tabular-nums tracking-tight">
        {formatUsd(total, locale)}
      </p>
      {spend.creditsUsd > 0 || spend.ownUsd > 0 ? (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
          {spend.creditsUsd > 0 ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t`Rook credits`}</dt>
              <dd className="m-0 tabular-nums">{formatUsd(spend.creditsUsd, locale)}</dd>
            </div>
          ) : null}
          {spend.ownUsd > 0 ? (
            <div className="flex gap-1.5">
              <dt className="text-muted-foreground">{t`Your accounts`}</dt>
              <dd
                className="m-0 tabular-nums"
                title={estimated ? t`Estimated at list price` : undefined}
              >
                {estimated ? "≈ " : ""}
                {formatUsd(spend.ownUsd, locale)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

/** One line of what went in, what the cache served and what came out. */
export function TokenStats({ cache, locale }: { cache: UsageCache; locale: string }) {
  const { t } = useLingui();
  const rate = usageHitRate(cache);
  const stats: Array<[string, string]> = [
    [t`Input`, formatTokens(cache.input, locale)],
    [t`Cached`, formatTokens(cache.cacheRead, locale)],
    ...(cache.cacheWrite ? [[t`Cache writes`, formatTokens(cache.cacheWrite, locale)]] : []),
    [t`Output`, formatTokens(cache.output, locale)],
    ...(rate === null
      ? []
      : [
          [
            t`Cache hit rate`,
            new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
              rate,
            ),
          ],
        ]),
  ] as Array<[string, string]>;
  return (
    <dl className="m-0 flex flex-wrap gap-x-8 gap-y-3">
      {stats.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
          <dd className="m-0 mt-0.5 text-[15px] tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Agents by what they spent; the failures count opens into short reasons. */
export function AgentList({
  agents,
  total,
  selected,
  onSelect,
  agentName,
  budgetOf,
  budgetLine,
  spendMode,
}: {
  agents: Agent[];
  total: number;
  selected: string | null;
  onSelect: (key: string | null) => void;
  agentName: (name: string) => string;
  budgetOf: (id: string | null) => { monthTokens: number; monthlyTokenLimit: number } | undefined;
  budgetLine: (budget: { monthTokens: number; monthlyTokenLimit: number }) => string;
  /** Money leads each row; with no priced calls it is the token count. */
  spendMode: boolean;
}) {
  const { t } = useLingui();
  const { locale, number, cached } = useFormats();
  const failureLabel = useFailureLabel();
  const repliesText = (replies: number) => {
    const count = number(replies);
    return t`${count} replies`;
  };
  const failedText = (failed: number) => {
    const count = number(failed);
    return t`${count} failed`;
  };
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<string | null>(null);
  const { shown, rest } = usageFold(agents);
  const rows = open ? agents : shown;
  return (
    <ul className="m-0 list-none p-0">
      {rows.map((item) => {
        const key = usageAgentKey(item.id);
        const isSelected = selected === key;
        const model = item.models[0];
        const budget = budgetOf(item.id);
        const kinds = usageFailureKinds(item.failureKinds);
        const failures = item.failed ?? 0;
        const share =
          total > 0 ? Math.min(1, (spendMode ? (item.spendUsd ?? 0) : item.tokens) / total) : 0;
        return (
          <li key={key}>
            <button
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? null : key)}
              className="grid w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-2.5 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
            >
              {item.color ? (
                <BotAvatar color={item.color} identity={key} size={28} />
              ) : (
                <span className="size-7 rounded-lg bg-muted" aria-hidden="true" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{agentName(item.name)}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">
                  {[model?.model, repliesText(item.replies), cached(item.cache)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-sm tabular-nums">
                {spendMode
                  ? formatUsd(item.spendUsd ?? 0, locale)
                  : formatTokens(item.tokens, locale)}
              </span>
              {agents.length > 1 ? (
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
            {failures > 0 ? (
              <div className="px-2 pb-2 ps-[48px] text-[12.5px] text-muted-foreground">
                <button
                  type="button"
                  aria-expanded={reasons === key}
                  onClick={() => setReasons(reasons === key ? null : key)}
                  className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {failedText(failures)}
                </button>
                {reasons === key && kinds.length > 0 ? (
                  <span>
                    {" · "}
                    {kinds
                      .map(([kind, count]) => `${failureLabel(kind)} ${number(count)}`)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>
            ) : null}
            {budget ? (
              <div className="px-2 pb-2.5">
                <Progress
                  aria-label={t`Monthly token limit`}
                  value={Math.min(
                    100,
                    Math.round((budget.monthTokens / budget.monthlyTokenLimit) * 100),
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
      {!open && rest.length > 0 ? (
        <li>
          <MoreButton count={rest.length} onClick={() => setOpen(true)} />
        </li>
      ) : null}
    </ul>
  );
}

/** Models by what they cost, each on the account that paid for it. */
export function AccountList({ accounts }: { accounts: UsageAccount[] }) {
  const { t } = useLingui();
  const { locale, number, cached } = useFormats();
  const [open, setOpen] = useState(false);
  const { shown, rest } = usageFold(accounts);
  const callsText = (calls: number) => {
    const count = number(calls);
    return t`${count} calls`;
  };
  const accountName = (account: UsageAccount) =>
    account.funding === "credits"
      ? t`Rook credits`
      : account.provider === "openai-codex"
        ? t`ChatGPT subscription`
        : (PROVIDER_NAMES[account.provider] ?? account.provider);
  return (
    <ul className="m-0 list-none p-0">
      {(open ? accounts : shown).map((account) => {
        return (
          <li
            key={`${account.funding}:${account.provider}:${account.model}`}
            className="flex items-baseline justify-between gap-4 px-2 py-2.5"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm">{account.model}</span>
              <span className="block truncate text-[12.5px] text-muted-foreground">
                {[accountName(account), callsText(account.calls), cached(account.cache)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="text-sm tabular-nums">
              {account.estimated ? "≈ " : ""}
              {formatUsd(account.spendUsd, locale)}
            </span>
          </li>
        );
      })}
      {!open && rest.length > 0 ? (
        <li>
          <MoreButton count={rest.length} onClick={() => setOpen(true)} />
        </li>
      ) : null}
    </ul>
  );
}
