import type { SubscriptionQuota } from "@corvo/contracts";
import { Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Asterisk, Orbit } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { useSpaceQueries } from "../lib/query";
import {
  quotaPeak,
  quotaProviderLabel,
  quotaWarns,
  quotaWindowNow,
  relativeTime,
} from "../lib/subscription-quota";

const GLYPHS: Record<string, ComponentType<{ className?: string; strokeWidth?: number }>> = {
  anthropic: Asterisk,
  "openai-codex": Orbit,
};

const SIZE = 40;
const CENTER = SIZE / 2;
/** The outer ring is the week and the inner one the 5 hour window. */
const RINGS = [
  { key: "7d", radius: 18 },
  { key: "5h", radius: 12 },
] as const;

/** Two arcs, one ink: how much of the week and of the 5 hour window is used. Warning color only when nearly full. */
function QuotaRing({ quota, now }: { quota: SubscriptionQuota; now: Date }) {
  const Glyph = GLYPHS[quota.provider] ?? Asterisk;
  return (
    <span className="relative grid size-7 place-items-center">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        {RINGS.map(({ key, radius }) => {
          const window = quota.windows.find((item) => item.key === key);
          const percent = window ? quotaWindowNow(window, now).usedPercent : 0;
          const length = 2 * Math.PI * radius;
          return (
            <g key={key}>
              <circle
                cx={CENTER}
                cy={CENTER}
                r={radius}
                fill="none"
                strokeWidth="3.5"
                className="stroke-foreground/12"
              />
              {window ? (
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={radius}
                  fill="none"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${(length * percent) / 100} ${length}`}
                  className={`transition-[stroke-dasharray] duration-300 motion-reduce:transition-none ${
                    quotaWarns(percent) ? "stroke-destructive" : "stroke-foreground"
                  }`}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      <Glyph className="size-3 text-foreground" strokeWidth={1.75} />
    </span>
  );
}

/** One provider's windows, in words. */
function QuotaDetails({ quota, now }: { quota: SubscriptionQuota; now: Date }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const label = quotaProviderLabel(quota.provider) ?? quota.provider;
  const updated = relativeTime(quota.readAt, now, locale);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{label}</p>
      {(["5h", "7d"] as const).map((key) => {
        const window = quota.windows.find((item) => item.key === key);
        if (!window) return null;
        const current = quotaWindowNow(window, now);
        const percent = Math.round(current.usedPercent);
        const when = relativeTime(window.resetsAt, now, locale);
        return (
          <div key={key}>
            <div className="flex items-baseline justify-between gap-4 text-[13px]">
              <span className="text-muted-foreground">
                {key === "5h" ? t`5-hour window` : t`Week`}
              </span>
              <span className="tabular-nums">{t`${percent}% used`}</span>
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-foreground/10">
              <div
                className={`h-full rounded-full ${quotaWarns(current.usedPercent) ? "bg-destructive" : "bg-foreground"}`}
                style={{ width: `${current.usedPercent}%` }}
              />
            </div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              {current.startedOver ? t`Started over` : t`Resets ${when}`}
            </p>
          </div>
        );
      })}
      <p className="text-[12px] text-muted-foreground">{t`Updated ${updated}`}</p>
    </div>
  );
}

/** A ring for each subscription that has reported, each opening its windows. Nothing when none has. */
export function SubscriptionRings({ quotas, now }: { quotas: SubscriptionQuota[]; now: Date }) {
  const { t } = useLingui();
  const shown = quotas.filter((quota) => quotaProviderLabel(quota.provider) !== null);
  if (shown.length === 0) return null;
  return (
    <div data-testid="subscription-rings" className="flex items-center">
      {shown.map((quota) => {
        const label = quotaProviderLabel(quota.provider) ?? quota.provider;
        const percent = Math.round(quotaPeak(quota, now));
        return (
          <Popover key={quota.provider}>
            <PopoverTrigger
              aria-label={t`${label}: ${percent}% used`}
              className="grid size-8 place-items-center rounded-md outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <QuotaRing quota={quota} now={now} />
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={8} className="w-64 p-4">
              <QuotaDetails quota={quota} now={now} />
            </PopoverContent>
          </Popover>
        );
      })}
    </div>
  );
}

/** The sidebar's rings, kept fresh: read again every minute and whenever the window is focused. */
export function SubscriptionRailRings() {
  const queries = useSpaceQueries();
  const { data } = useQuery({
    ...queries.usage.subscriptions.queryOptions(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return <SubscriptionRings quotas={data ?? []} now={now} />;
}
