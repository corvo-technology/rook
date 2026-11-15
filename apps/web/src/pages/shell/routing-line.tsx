import type { RoutingReason, RoutingReport } from "@corvo/contracts";
import { isAnswering } from "@corvo/core";
import { BotAvatar, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";

/** The most faces the line draws before the popover holds the rest. */
const LINE_FACES = 3;

type Agent = { name: string; color: string };

/** Whether the line is worth drawing: the router decided, nobody answered, or an agent could not. */
export function showsRouting(report: RoutingReport): boolean {
  return (
    report.by === "router" ||
    !report.agents.some((agent) => isAnswering(agent.reason)) ||
    report.agents.some(
      (agent) =>
        agent.reason === "paused" ||
        agent.reason === "over_budget" ||
        agent.reason === "not_in_audience",
    )
  );
}

/**
 * Under a person's message in a channel: who the router sent it to, or that no one answered. The
 * popover has each agent considered and the reason, for when a person wonders why one stayed quiet.
 */
export function RoutingLine({
  report,
  agent,
}: {
  report: RoutingReport;
  /** An agent's name and color, or nothing once it has left the space. */
  agent: (botId: string) => Agent | undefined;
}) {
  const { t } = useLingui();
  const reasonLabel: Record<RoutingReason, string> = {
    router_picked: t`Picked for this`,
    mentioned: t`Mentioned`,
    thread_owner: t`Already in this conversation`,
    follow_up: t`Answered just before`,
    router_failed: t`Answered by default, the router was unavailable`,
    not_picked: t`Not picked`,
    none_needed: t`No answer needed`,
    not_in_audience: t`Not available to you`,
    paused: t`Paused`,
    over_budget: t`Over its budget`,
  };
  const known = report.agents.flatMap((entry) => {
    const found = agent(entry.botId);
    return found ? [{ ...entry, ...found }] : [];
  });
  const answering = known.filter((entry) => isAnswering(entry.reason));
  const label =
    answering.length > 0 ? answering.map((entry) => entry.name).join(", ") : t`No one answered`;
  return (
    <Popover>
      <PopoverTrigger
        data-testid="routing-line"
        openOnHover
        aria-label={answering.length > 0 ? t`Sent to ${label}` : label}
        className="mt-1 flex max-w-full items-center gap-1.5 rounded-md text-meta text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {answering.length > 0 ? (
          <>
            <span aria-hidden="true">→</span>
            <span className="flex items-center gap-0.5" aria-hidden="true">
              {answering.slice(0, LINE_FACES).map((entry) => (
                <BotAvatar key={entry.botId} color={entry.color} identity={entry.botId} size={16} />
              ))}
            </span>
            <span className="min-w-0 truncate" aria-hidden="true">
              {label}
            </span>
          </>
        ) : (
          label
        )}
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        data-testid="routing-popover"
        className="w-72 gap-2 p-3"
      >
        <ul className="flex flex-col gap-1.5">
          {known.map((entry) => (
            <li key={entry.botId} className="flex items-center gap-2 text-body2">
              <BotAvatar color={entry.color} identity={entry.botId} size={16} />
              <span className="min-w-0 truncate font-medium text-foreground">{entry.name}</span>
              <span className="ml-auto shrink-0 text-right text-muted-foreground">
                {reasonLabel[entry.reason]}
              </span>
            </li>
          ))}
        </ul>
        {report.note ? (
          <p dir="auto" className="text-meta text-muted-foreground">
            {t`Router's note`}: {report.note}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
