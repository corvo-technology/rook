import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { Check, ChevronDown } from "lucide-react";
import type { HomeStatus } from "../../lib/home-live";
import type { StartPage } from "../../lib/home-prefs";
import { useCountUp } from "./hooks";

/** One number of the live line; it counts up when it first shows and eases to each new value. */
function Segment({ value, text }: { value: number; text: (n: number) => string }) {
  const shown = useCountUp(value);
  return <span>{text(shown)}</span>;
}

/** Where the app opens, chosen per person. */
function StartPick({ value, onChange }: { value: StartPage; onChange: (page: StartPage) => void }) {
  const { t } = useLingui();
  const labels: Record<StartPage, string> = { home: t`Home`, chat: t`Chat` };
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{t`On open`}</span>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-testid="home-start-pick"
          className="rk-home-lift flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {labels[value]}
          <ChevronDown aria-hidden className="size-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {(Object.keys(labels) as StartPage[]).map((page) => (
            <DropdownMenuItem key={page} onClick={() => onChange(page)}>
              {labels[page]}
              {page === value ? <Check aria-hidden className="ms-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The greeting, a calm line under it, and a muted line of what the team is doing now. */
export function HomeHero({
  greeting,
  status,
  start,
  onStart,
}: {
  greeting: string;
  status: HomeStatus;
  start: StartPage;
  onStart: (page: StartPage) => void;
}) {
  const { t } = useLingui();
  const { working, waiting, nextInMinutes } = status;
  const hours = nextInMinutes !== null && nextInMinutes >= 90;
  const next = nextInMinutes === null ? 0 : hours ? Math.round(nextInMinutes / 60) : nextInMinutes;
  const busy = working > 0 || waiting > 0 || nextInMinutes !== null;
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-[44px] sm:leading-[1.05]">
          {greeting}
        </h1>
        <p className="text-base text-muted-foreground">{t`Your workspace is ready. Start here.`}</p>
        {busy ? (
          <p
            data-testid="home-status"
            className="flex flex-wrap items-center gap-x-2.5 font-mono text-xs tabular-nums text-muted-foreground"
          >
            {working > 0 ? (
              <Segment
                value={working}
                text={(n) => t`${plural(n, { one: "# agent working", other: "# agents working" })}`}
              />
            ) : null}
            {working > 0 && waiting > 0 ? <span aria-hidden>·</span> : null}
            {waiting > 0 ? (
              <Segment
                value={waiting}
                text={(n) =>
                  t`${plural(n, { one: "# waiting for you", other: "# waiting for you" })}`
                }
              />
            ) : null}
            {(working > 0 || waiting > 0) && nextInMinutes !== null ? (
              <span aria-hidden>·</span>
            ) : null}
            {nextInMinutes !== null ? (
              <Segment
                value={next}
                text={(n) =>
                  hours
                    ? t`next routine in ${plural(n, { one: "# hour", other: "# hours" })}`
                    : t`next routine in ${n} min`
                }
              />
            ) : null}
          </p>
        ) : null}
      </div>
      <StartPick value={start} onChange={onStart} />
    </header>
  );
}
