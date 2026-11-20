import type { PartnerConsolePartner } from "@corvo/contracts";
import { Skeleton } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "../../lib/rpc";
import { Panel, PartnerError } from "./partner-ui";

/** What the partner's system sent lately, with what went wrong, to debug an integration. */
export function PartnerEvents({ partner }: { partner: PartnerConsolePartner }) {
  const { t, i18n } = useLingui();
  const events = useQuery({
    queryKey: ["partner-console", partner.id, "events"],
    queryFn: () => rpc.partnerConsole.events({ partnerId: partner.id }),
  });
  const time = new Intl.DateTimeFormat(i18n.locale || "en", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <Panel title={t`Events`} data-testid="partner-events">
      {events.isError ? (
        <PartnerError error={events.error} onRetry={events.refetch} />
      ) : events.isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" data-testid="partner-loading" />
      ) : events.data.recent.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">{t`No events yet`}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-[14px] tabular-nums" data-testid="partner-events-counts">
            {t`24h: ${events.data.accepted} received, ${events.data.rejected} rejected`}
          </p>
          <ul className="divide-y divide-border">
            {events.data.recent.map((event) => (
              <li key={event.id} className="py-2 text-[14px]">
                <div className="flex items-center justify-between gap-3">
                  <code className="min-w-0 truncate text-[13px]">{event.type}</code>
                  <span className="shrink-0 text-meta text-muted-foreground">
                    {event.externalTenantId} · {time.format(new Date(event.createdAt))}
                  </span>
                </div>
                {event.status === "rejected" ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-destructive">{event.error}</summary>
                    {event.payload ? (
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-[12px]">
                        {event.payload}
                      </pre>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
