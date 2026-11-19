import type { EventRoutine, PartnerEventType } from "@corvo/contracts";
import { Switch } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

/** The routines a product's own events start, worded as the moment they wait for. */
export function EventRoutines() {
  const { t, i18n } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const events = useQuery(queries.routines.events.queryOptions({ input: {} }));
  const routines = events.data ?? [];
  if (routines.length === 0) return null;

  const moment: Record<PartnerEventType, string> = {
    "appointment.created": t`When an appointment is booked…`,
    "appointment.cancelled": t`When an appointment is cancelled…`,
    "appointment.no_show": t`When a customer doesn't show up…`,
    "payment.overdue": t`When a payment is overdue…`,
    "consultation.finished": t`When a consultation ends…`,
    "customer.created": t`When a new customer is added…`,
    "customer.inactive": t`When a customer stops coming…`,
    custom: t`When something happens…`,
  };
  const when = new Intl.DateTimeFormat(i18n.locale, { dateStyle: "short", timeStyle: "short" });

  async function toggle(routine: EventRoutine, active: boolean) {
    setError(null);
    try {
      await rpc.routines.update({ routineId: routine.id, active });
    } catch (reason) {
      setError(errorText(reason, t`Could not update the routine`));
    }
    await queryClient.invalidateQueries({ queryKey: queries.routines.events.key() });
  }

  return (
    <section className="px-6 pb-3" data-testid="event-routines">
      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border/60">
        {routines.map((routine) => (
          <li key={routine.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{moment[routine.on.type]}</span>
              <span className="block truncate text-[13px] text-muted-foreground">
                {routine.name}
                {routine.lastTriggeredAt
                  ? ` · ${when.format(new Date(routine.lastTriggeredAt))}`
                  : ""}
              </span>
            </span>
            <Switch
              checked={routine.active}
              aria-label={routine.name}
              onCheckedChange={(active) => void toggle(routine, active)}
            />
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
