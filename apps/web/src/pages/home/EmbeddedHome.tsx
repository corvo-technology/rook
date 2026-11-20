import type { Bot, PartnerQuickAction, PendingApproval, RunActivityRow } from "@corvo/contracts";
import { useLingui } from "@lingui/react/macro";
import { ArrowUpRight, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { PartnerBalance } from "../../lib/embedded-home";
import { cardLink, HomeCard } from "./HomeCard";
import { PartnerBalanceLine } from "./PartnerBalance";
import { WaitingList } from "./WaitingList";
import { WorkingFeed } from "./WorkingFeed";

const rise = (i: number) => ({ "--rk-i": i }) as React.CSSProperties;
const noop = () => undefined;

/**
 * Home inside a partner's product: a greeting, the shortcuts of the partner's trade, a prompt for
 * the Chief, what its agents are doing and what waits on the person, and the month's credit.
 */
export function EmbeddedHome({
  greeting,
  actions,
  onAction,
  composer,
  waiting,
  working,
  bots,
  balance,
  locale,
  onGiveWork,
}: {
  greeting: string;
  actions: readonly PartnerQuickAction[];
  onAction: (action: PartnerQuickAction) => void;
  composer: ReactNode;
  waiting: { items: PendingApproval[]; total: number };
  working: { items: RunActivityRow[]; total: number };
  bots: readonly Bot[];
  balance: PartnerBalance | null;
  locale: string;
  onGiveWork: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  return (
    <div
      data-testid="home-page"
      data-embedded
      className="relative h-full min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
        <h1
          className="rk-home-rise font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          style={rise(0)}
        >
          {greeting}
        </h1>

        <div className="rk-home-rise" style={rise(1)}>
          {composer}
        </div>

        {actions.length > 0 ? (
          <ul
            data-testid="embed-quick-actions"
            className="rk-home-rise grid gap-2 sm:grid-cols-2"
            style={rise(2)}
          >
            {actions.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  onClick={() => onAction(action)}
                  className="rk-home-lift group flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-start text-sm font-medium outline-none hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    {action.open ? (
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    ) : (
                      <Sparkles aria-hidden className="size-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">{action.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="rk-home-rise" style={rise(3)}>
          <PartnerBalanceLine balance={balance} locale={locale} />
        </div>

        <div className="grid items-stretch gap-4 md:grid-cols-2">
          <div className="rk-home-rise flex flex-col" style={rise(4)}>
            <HomeCard
              className="flex-1"
              testId="home-waiting"
              title={t`Waiting for you`}
              name={t`Waiting for you`}
              action={
                waiting.total > 0 ? (
                  <button
                    type="button"
                    className={cardLink}
                    onClick={() => navigate("/app/approvals")}
                  >
                    {t`See all`}
                  </button>
                ) : null
              }
              band={false}
              organizing={false}
              onMove={noop}
              onHide={noop}
            >
              <WaitingList items={waiting.items} />
            </HomeCard>
          </div>
          <div className="rk-home-rise flex flex-col" style={rise(5)}>
            <HomeCard
              className="flex-1"
              testId="home-working"
              title={t`Working now`}
              name={t`Working now`}
              band={false}
              organizing={false}
              onMove={noop}
              onHide={noop}
            >
              <WorkingFeed runs={working.items} bots={bots} onGiveWork={onGiveWork} />
            </HomeCard>
          </div>
        </div>
      </div>
    </div>
  );
}
