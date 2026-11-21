import type { UsageBar } from "../../lib/usage-view";
import { usageDayLabel } from "../../lib/usage-view";

/** One bar a day, in a single ink: the chosen agent stays dark and the rest of the day fades. */
export function UsageChart({
  bars,
  locale,
  readout,
  onHover,
  valueLabel,
}: {
  bars: UsageBar[];
  locale: string;
  /** Text for the line above the bars; the page owns the wording. */
  readout: string;
  onHover: (index: number | null) => void;
  valueLabel: (value: number) => string;
}) {
  const first = bars[0];
  const last = bars.at(-1);
  const middle = bars[Math.floor(bars.length / 2)];
  return (
    <figure className="m-0">
      <p aria-live="polite" className="h-5 text-[13px] tabular-nums text-muted-foreground">
        {readout}
      </p>
      <div className="mt-2 flex h-40 items-end gap-[3px] border-b border-border">
        {bars.map((bar, index) => (
          <button
            key={bar.date}
            type="button"
            aria-label={`${usageDayLabel(bar.date, locale)}, ${valueLabel(bar.value)}`}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(index)}
            onBlur={() => onHover(null)}
            className="group relative h-full min-w-0 flex-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {bar.value === 0 ? (
              <span
                className="absolute inset-x-0 bottom-0 h-px bg-foreground/15"
                aria-hidden="true"
              />
            ) : null}
            <span
              className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/15 transition-[height] duration-200 ease-out motion-reduce:transition-none"
              style={{ height: `${Math.max(bar.value > 0 ? 2 : 0, bar.height * 100)}%` }}
            >
              <span
                className="absolute inset-x-0 bottom-0 rounded-t-sm bg-foreground/80 transition-[height,background-color] duration-200 ease-out group-hover:bg-foreground motion-reduce:transition-none"
                style={{ height: `${bar.focus * 100}%` }}
              />
            </span>
          </button>
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-[12px] tabular-nums text-muted-foreground">
        <span>{first ? usageDayLabel(first.date, locale) : ""}</span>
        <span>{middle && bars.length > 6 ? usageDayLabel(middle.date, locale) : ""}</span>
        <span>{last && last !== first ? usageDayLabel(last.date, locale) : ""}</span>
      </figcaption>
    </figure>
  );
}
