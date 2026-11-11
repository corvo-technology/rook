import type { Bot, RoutineOccurrence } from "@corvo/contracts";
import { BotAvatar, Button, botAccent, Spinner, ToggleGroup, ToggleGroupItem } from "@corvo/ui-web";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Clock, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { useSpaceQueries } from "../lib/query";
import type { CalendarView } from "../lib/routine-calendar";
import {
  dayKey,
  groupByDay,
  shiftAnchor,
  summarizeCalendar,
  visibleDays,
  visibleRange,
} from "../lib/routine-calendar";
import { errorText } from "../lib/user-error";
import { NewRoutineDialog } from "./NewRoutineDialog";
import { RoutineCard } from "./RoutineCard";
import { blockStyle, RoutineTimeGrid } from "./RoutineTimeGrid";
import { WindowChrome } from "./WindowChrome";

const NO_BOTS: Bot[] = [];
const MONTH_CHIPS_PER_DAY = 3;
const UPCOMING_COUNT = 6;
const DAY_MS = 24 * 60 * 60_000;
const segment =
  "h-7 rounded-full px-3 text-[13px] hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm";

/** Every routine in one place: what ran, what failed and what is due, with a way to add one. */
export function RoutinesPage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<RoutineOccurrence | null>(null);

  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const botById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  const days = useMemo(() => visibleDays(anchor, view), [anchor, view]);
  const range = useMemo(() => visibleRange(anchor, view), [anchor, view]);
  const calendar = useQuery(
    queries.routines.calendar.queryOptions({
      input: { from: range.from.toISOString(), to: range.to.toISOString() },
    }),
  );
  const [upcomingFrom] = useState(() => new Date());
  const upcoming = useQuery(
    queries.routines.calendar.queryOptions({
      input: {
        from: upcomingFrom.toISOString(),
        to: new Date(upcomingFrom.getTime() + 7 * DAY_MS).toISOString(),
      },
    }),
  );

  const grouped = useMemo(() => groupByDay(calendar.data?.occurrences ?? []), [calendar.data]);
  const next = (upcoming.data?.occurrences ?? [])
    .filter((item) => item.state === "upcoming")
    .slice(0, UPCOMING_COUNT);
  const today = dayKey(new Date());
  const summary = useMemo(
    () => summarizeCalendar(calendar.data?.occurrences ?? [], new Date()),
    [calendar.data],
  );
  const nextUp = useMemo(
    () => summarizeCalendar(upcoming.data?.occurrences ?? [], new Date()).next,
    [upcoming.data],
  );
  // "All good" only means something once there is something that already happened to be good.
  const happened = (calendar.data?.occurrences ?? []).some((item) => item.state !== "upcoming");

  const title = new Intl.DateTimeFormat(i18n.locale, {
    month: "long",
    year: "numeric",
    ...(view === "month" ? {} : { day: "numeric" }),
  }).format(anchor);
  const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat(i18n.locale, { day: "numeric" });
  const clock = new Intl.DateTimeFormat(i18n.locale, { hour: "numeric", minute: "2-digit" });

  const openRoutine = setSelected;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="app-drag flex items-center gap-2 px-4 pt-3">
        <WindowChrome />
      </div>
      <header className="flex flex-wrap items-center gap-2 px-6 py-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Previous`}
          onClick={() => setAnchor((value) => shiftAnchor(value, view, -1))}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
          <Trans>Today</Trans>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t`Next`}
          onClick={() => setAnchor((value) => shiftAnchor(value, view, 1))}
        >
          <ChevronRight />
        </Button>
        <h1 className="ms-2 text-lg font-normal tracking-tight capitalize">{title}</h1>
        <div className="ms-auto flex items-center gap-2">
          <ToggleGroup
            spacing={0}
            className="rounded-full bg-muted p-0.5"
            value={[view]}
            onValueChange={(next) => next[0] && setView(next[0] as CalendarView)}
          >
            <ToggleGroupItem value="day" className={segment}>
              <Trans>Day</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className={segment}>
              <Trans>Week</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="month" className={segment}>
              <Trans>Month</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button size="sm" disabled={bots.length === 0} onClick={() => setCreating(true)}>
            <Plus />
            <Trans>New routine</Trans>
          </Button>
        </div>
      </header>

      {summary.failed[0] || happened || nextUp ? (
        <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
          {summary.failed[0] ? (
            <button
              type="button"
              onClick={() => openRoutine(summary.failed[0] as RoutineOccurrence)}
              className="flex items-center gap-1.5 rounded-full border border-destructive/50 bg-destructive/10 px-3 py-1 text-[13px] text-foreground transition-colors outline-none hover:bg-destructive/20 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5 text-destructive" aria-hidden="true" />
              <span className="font-medium">
                <Plural value={summary.failed.length} one="# failed" other="# failed" />
              </span>
              <span className="max-w-64 truncate text-muted-foreground">
                {summary.failed[0].name}
              </span>
            </button>
          ) : happened ? (
            <span className="flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-[13px]">
              <Check className="size-3.5 text-success" aria-hidden="true" />
              <span className="font-medium">
                <Trans>All good</Trans>
              </span>
            </span>
          ) : null}
          {nextUp ? (
            <button
              type="button"
              onClick={() => openRoutine(nextUp)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px] transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="text-muted-foreground">
                <Trans>Next</Trans>
              </span>
              <span className="tabular-nums">
                {weekday.format(new Date(nextUp.at))} {clock.format(new Date(nextUp.at))}
              </span>
              <span className="max-w-64 truncate text-muted-foreground">{nextUp.name}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-4 px-6 pb-6">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {calendar.error && !calendar.data ? (
            <p role="alert" className="text-sm text-destructive">
              {errorText(calendar.error, t`Could not load routines.`)}
            </p>
          ) : null}
          {calendar.isPending ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : view === "month" ? (
            <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-2 overflow-y-auto">
              {days.map((day) => {
                const key = dayKey(day);
                const items = grouped.get(key) ?? [];
                const shown = items.slice(0, MONTH_CHIPS_PER_DAY);
                const hidden = items.length - shown.length;
                const outside = day.getMonth() !== anchor.getMonth();
                const openDay = () => {
                  setAnchor(day);
                  setView("day");
                };
                return (
                  <section
                    key={key}
                    className={`min-h-24 rounded-2xl border p-2 ${
                      key === today ? "border-brand/40 bg-brand/5" : "border-border/60"
                    } ${outside ? "opacity-50" : ""}`}
                  >
                    <h2 className="mb-1.5 text-[13px] text-muted-foreground">
                      <button
                        type="button"
                        onClick={openDay}
                        className="rounded-md px-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {weekday.format(day)}{" "}
                        <span className="text-foreground">{dayNumber.format(day)}</span>
                      </button>
                    </h2>
                    <ul className="flex flex-col gap-1">
                      {shown.map((item) => (
                        <li key={`${item.routineId}-${item.at}`}>
                          <OccurrenceChip
                            item={item}
                            bot={botById.get(item.botId)}
                            time={clock.format(new Date(item.at))}
                            onOpen={() => openRoutine(item)}
                          />
                        </li>
                      ))}
                    </ul>
                    {hidden > 0 ? (
                      <button
                        type="button"
                        onClick={openDay}
                        className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Plural value={hidden} one="+# more" other="+# more" />
                      </button>
                    ) : null}
                  </section>
                );
              })}
            </div>
          ) : (
            <RoutineTimeGrid
              days={days}
              occurrences={grouped}
              botById={botById}
              onOpen={openRoutine}
              onOpenDay={
                view === "week"
                  ? (day) => {
                      setAnchor(day);
                      setView("day");
                    }
                  : undefined
              }
            />
          )}
          {calendar.data?.truncated ? (
            <p className="mt-3 text-xs text-muted-foreground">
              <Trans>Some runs are not shown.</Trans>
            </p>
          ) : null}
        </div>

        <aside className="hidden w-72 shrink-0 overflow-y-auto lg:block">
          <h2 className="mb-2 px-2 text-sm text-muted-foreground">
            <Trans>Upcoming</Trans>
          </h2>
          <ul className="flex flex-col">
            {next.map((item) => {
              const bot = botById.get(item.botId);
              return (
                <li key={`${item.routineId}-${item.at}`}>
                  <button
                    type="button"
                    onClick={() => openRoutine(item)}
                    className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-start transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {bot ? (
                      <BotAvatar
                        color={bot.color}
                        identity={bot.id}
                        size={22}
                        status={bot.status}
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{item.name}</span>
                      <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
                        {weekday.format(new Date(item.at))} {clock.format(new Date(item.at))}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>

      {selected ? (
        <RoutineCard
          item={selected}
          time={`${weekday.format(new Date(selected.at))} ${clock.format(new Date(selected.at))}`}
          onOpenAgent={() => navigate(`/app/${selected.botId}`)}
          onRan={() => {
            setSelected(null);
            void queryClient.invalidateQueries({ queryKey: queries.routines.calendar.key() });
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}
      {creating ? (
        <NewRoutineDialog
          bots={bots}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: queries.routines.calendar.key() });
          }}
        />
      ) : null}
    </div>
  );
}

function OccurrenceChip({
  item,
  bot,
  time,
  onOpen,
}: {
  item: RoutineOccurrence;
  bot: Bot | undefined;
  time: string;
  onOpen: () => void;
}) {
  const accent = bot ? botAccent(bot.color, bot.id) : undefined;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={blockStyle(item, accent)}
      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-start text-xs transition-[filter,transform] duration-150 outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transition-none"
    >
      {bot ? <BotAvatar color={bot.color} identity={bot.id} size={14} status={bot.status} /> : null}
      <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
      {item.state === "failed" ? (
        <X className="size-3 shrink-0 text-destructive" aria-hidden="true" />
      ) : item.state === "running" ? (
        <Spinner className="size-3 shrink-0" />
      ) : null}
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
        {time}
      </span>
    </button>
  );
}
