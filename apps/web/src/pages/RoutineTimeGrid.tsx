import type { Bot, RoutineOccurrence } from "@corvo/contracts";
import { BotAvatar, botAccent, Spinner } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dayKey, HOUR_HEIGHT, layoutDayEvents, nowOffset } from "../lib/routine-calendar";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const GUTTER = "3rem";

/** How much of the bot's color a block carries: what is still to come is the lightest. */
const FILL: Record<RoutineOccurrence["state"], number> = {
  done: 22,
  failed: 22,
  running: 30,
  upcoming: 12,
};

/** A solid block in the bot's color at low opacity; failures read in the destructive color. */
export function blockStyle(item: RoutineOccurrence, accent: string | undefined): CSSProperties {
  const base =
    item.state === "failed" ? "var(--destructive)" : (accent ?? "var(--muted-foreground)");
  return {
    "--block": base,
    backgroundColor: `color-mix(in srgb, var(--block) ${FILL[item.state]}%, transparent)`,
  } as CSSProperties;
}

/**
 * One or seven days laid out by the hour, so a person sees when each routine ran, whether it
 * worked, and what is coming. The page scrolls inside it; the day names stay in view.
 */
export function RoutineTimeGrid({
  days,
  occurrences,
  botById,
  onOpen,
  onOpenDay,
}: {
  days: Date[];
  occurrences: Map<string, RoutineOccurrence[]>;
  botById: Map<string, Bot>;
  onOpen: (item: RoutineOccurrence) => void;
  /** Present when the grid is a week: choosing a day name shows that day alone. */
  onOpenDay?: (day: Date) => void;
}) {
  const { t, i18n } = useLingui();
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const today = dayKey(now);
  const showsToday = days.some((day) => dayKey(day) === today);
  // Open on the working part of the day, or just before the present when today is in view.
  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = Math.max(
        0,
        (showsToday ? nowOffset(new Date()) : 7 * HOUR_HEIGHT) - 2 * HOUR_HEIGHT,
      );
    }
  }, [showsToday]);

  const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat(i18n.locale, { day: "numeric" });
  const fullDay = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "full" });
  const clock = new Intl.DateTimeFormat(i18n.locale, { hour: "numeric", minute: "2-digit" });
  const hourLabel = new Intl.DateTimeFormat(i18n.locale, { hour: "numeric" });
  const columns = `${GUTTER} repeat(${days.length}, minmax(0, 1fr))`;
  const stateLabel: Record<RoutineOccurrence["state"], string> = {
    done: t`Done`,
    failed: t`Failed`,
    running: t`Running`,
    upcoming: t`Upcoming`,
  };

  const placedByDay = useMemo(
    () => days.map((day) => layoutDayEvents(occurrences.get(dayKey(day)) ?? [])),
    [days, occurrences],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div
        className="grid shrink-0 border-b border-border/60"
        style={{ gridTemplateColumns: columns }}
      >
        <div />
        {days.map((day) => {
          const isToday = dayKey(day) === today;
          const content = (
            <>
              <span className="text-label text-muted-foreground capitalize">
                {weekday.format(day)}
              </span>
              <span
                className={`mx-auto mt-0.5 grid size-8 place-items-center rounded-full text-heading3 ${
                  isToday ? "bg-brand text-brand-foreground" : "text-foreground"
                }`}
              >
                {dayNumber.format(day)}
              </span>
            </>
          );
          return onOpenDay ? (
            <button
              key={dayKey(day)}
              type="button"
              aria-label={t`Open ${fullDay.format(day)}`}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onOpenDay(day)}
              className={`py-2 text-center transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring ${isToday ? "bg-brand/5" : ""}`}
            >
              {content}
            </button>
          ) : (
            <div
              key={dayKey(day)}
              aria-current={isToday ? "date" : undefined}
              className={`py-2 text-center ${isToday ? "bg-brand/5" : ""}`}
            >
              {content}
            </div>
          );
        })}
      </div>

      <div ref={scroller} className="rk-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative text-end text-caption text-muted-foreground"
                style={{ height: HOUR_HEIGHT }}
              >
                {hour === 0 ? null : (
                  <span className="absolute -top-2 end-2 font-mono text-[11px] tabular-nums">
                    {hourLabel.format(new Date(2026, 0, 1, hour))}
                  </span>
                )}
              </div>
            ))}
          </div>
          {days.map((day, index) => {
            const isToday = dayKey(day) === today;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a calendar column, not form fields
              <div
                key={dayKey(day)}
                role="group"
                data-testid="routine-day"
                aria-label={fullDay.format(day)}
                className={`relative border-s border-border/40 ${isToday ? "bg-brand/5" : ""}`}
                style={{ height: HOUR_HEIGHT * 24 }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="border-t border-border/30"
                    style={{ height: HOUR_HEIGHT }}
                  />
                ))}
                {(placedByDay[index] ?? []).map(({ item, top, height, column, columns: lanes }) => {
                  const bot = botById.get(item.botId);
                  const time = clock.format(new Date(item.at));
                  return (
                    <button
                      key={`${item.routineId}-${item.at}`}
                      type="button"
                      aria-label={`${item.name}, ${time}, ${stateLabel[item.state]}`}
                      onClick={() => onOpen(item)}
                      className="absolute flex items-start gap-1.5 overflow-hidden rounded-xl px-2 py-1.5 text-start text-label text-foreground transition-[filter,transform] duration-150 outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] motion-reduce:transition-none"
                      style={{
                        top,
                        height: height - 2,
                        insetInlineStart: `calc(${(column / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        ...blockStyle(item, bot ? botAccent(bot.color, bot.id) : undefined),
                      }}
                    >
                      {bot && lanes < 3 ? (
                        <BotAvatar
                          color={bot.color}
                          identity={bot.id}
                          size={14}
                          status={bot.status}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 leading-4">
                        <span className="block truncate font-medium">{item.name}</span>
                        <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                          {time}
                        </span>
                      </span>
                      {item.state === "failed" ? (
                        <X className="mt-0.5 size-3 shrink-0 text-destructive" aria-hidden />
                      ) : item.state === "running" ? (
                        <Spinner className="mt-0.5 size-3 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
                {isToday ? (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 h-px bg-brand"
                    style={{ top: nowOffset(now) }}
                  >
                    <span className="absolute -start-1 -top-[3px] size-[7px] rounded-full bg-brand" />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
