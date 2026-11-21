import type { QuietHours } from "@corvo/contracts";
import { Input, Label, Switch } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useId, useState } from "react";
import { SettingsRow } from "../components/SettingsRows";

/** Minutes after midnight as the "HH:MM" a time input reads. */
export function clockText(minutes: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The minutes a time input holds; null while it is empty or half typed. */
export function clockMinutes(text: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** When pushes from background work wait, in the person's timezone. */
export function QuietHoursRow({
  value,
  onChange,
}: {
  value: QuietHours;
  onChange: (next: QuietHours) => Promise<unknown>;
}) {
  const { t } = useLingui();
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  const switchId = useId();

  function save(next: QuietHours) {
    setShown(next);
    onChange(next).catch(() => setShown(value));
  }

  return (
    <div data-testid="quiet-hours-settings">
      <SettingsRow
        label={
          <Label htmlFor={switchId} className="text-[14px] font-normal text-foreground">
            <Trans>Quiet hours</Trans>
          </Label>
        }
        control={
          <Switch
            id={switchId}
            data-testid="quiet-hours-toggle"
            checked={shown.enabled}
            onCheckedChange={(enabled) => save({ ...shown, enabled })}
          />
        }
      >
        {shown.enabled ? (
          <div className="mt-2 flex justify-end gap-2">
            <Input
              type="time"
              aria-label={t`Start`}
              data-testid="quiet-hours-start"
              className="w-28"
              value={clockText(shown.start)}
              onChange={(event) => {
                const start = clockMinutes(event.target.value);
                if (start !== null) save({ ...shown, start });
              }}
            />
            <Input
              type="time"
              aria-label={t`End`}
              data-testid="quiet-hours-end"
              className="w-28"
              value={clockText(shown.end)}
              onChange={(event) => {
                const end = clockMinutes(event.target.value);
                if (end !== null) save({ ...shown, end });
              }}
            />
          </div>
        ) : null}
      </SettingsRow>
    </div>
  );
}
