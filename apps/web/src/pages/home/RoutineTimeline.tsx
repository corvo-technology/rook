import type { Bot } from "@corvo/contracts";
import { BotAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Link } from "react-router-dom";
import type { Timeline, TimelineEntry } from "../../lib/home-live";
import { TIMELINE_DAY_LIMIT } from "../../lib/home-live";

/** The body of the "Next routines" card: today and tomorrow in order, a thin line where now falls. */
export function RoutineTimeline({
  timeline,
  bots,
  now,
  locale,
}: {
  timeline: Timeline;
  bots: readonly Bot[];
  now: Date;
  locale: string;
}) {
  const { t } = useLingui();
  const clockTime = (date: Date) =>
    date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const today = timeline.today.slice(0, TIMELINE_DAY_LIMIT);
  const tomorrow = timeline.tomorrow.slice(0, TIMELINE_DAY_LIMIT);
  if (today.length === 0 && tomorrow.length === 0) {
    return (
      <Link
        to="/app/routines"
        className="text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t`No routines scheduled.`}
      </Link>
    );
  }
  const when = (entry: TimelineEntry, isToday: boolean) => {
    const time = clockTime(new Date(entry.at));
    return isToday ? t`today ${time}` : t`tomorrow ${time}`;
  };
  const row = (entry: TimelineEntry, isToday: boolean) => {
    const bot = bots.find((candidate) => candidate.id === entry.botId);
    return (
      <li key={`${entry.routineId}:${entry.at}`}>
        <Link
          to="/app/routines"
          className={`rk-home-lift flex items-center gap-3 rounded-xl px-2 py-2.5 outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring ${
            entry.past ? "opacity-55" : ""
          }`}
        >
          {bot ? <BotAvatar color={bot.color} identity={bot.id} size={30} /> : null}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="text-sm font-semibold">{entry.name}</span>
            <span className="text-[13px] text-muted-foreground">{entry.botName}</span>
          </span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {when(entry, isToday)}
          </span>
        </Link>
      </li>
    );
  };
  const now0 = Math.min(timeline.nowIndex, today.length);
  return (
    <ul className="flex flex-col">
      {today.flatMap((entry, index) => [
        index === now0 ? <NowLine key="now" time={clockTime(now)} /> : null,
        row(entry, true),
      ])}
      {now0 >= today.length && today.length > 0 ? (
        <NowLine key="now" time={clockTime(now)} />
      ) : null}
      {tomorrow.map((entry) => row(entry, false))}
    </ul>
  );
}

function NowLine({ time }: { time: string }) {
  return (
    <li aria-hidden data-testid="home-now" className="flex items-center gap-3 px-2 py-0.5">
      <span className="font-mono text-[11px] font-medium tabular-nums">{time}</span>
      <span className="rk-home-now h-px flex-1" />
    </li>
  );
}
