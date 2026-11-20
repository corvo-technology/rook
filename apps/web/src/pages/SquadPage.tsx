import { isRunWorking } from "@corvo/core";
import { BotAvatar, Button, Spinner } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { useSpaceQueries } from "../lib/query";
import { buildSquadLanes, squadRouter } from "../lib/squad-lanes";

const FAST_REFRESH_MS = 2_500;
const IDLE_REFRESH_MS = 15_000;

/** One squad as a lane per bot: who has the work, what each is using, and what was handed over. */
export function SquadPage() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const { groupId = "" } = useParams();
  const thread = useQuery({
    ...queries.threads.get.queryOptions({ input: { groupId } }),
    enabled: Boolean(groupId),
    // Lanes change while bots work, so follow them closely then and relax once all are idle.
    refetchInterval: (query) =>
      query.state.data?.members?.some((member) => isRunWorking(member.status))
        ? FAST_REFRESH_MS
        : IDLE_REFRESH_MS,
  });
  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? [];

  const snapshot = thread.data;
  const input = useMemo(
    () => ({ members: snapshot?.members ?? [], messages: snapshot?.messages ?? [] }),
    [snapshot],
  );
  const lanes = useMemo(() => buildSquadLanes(input), [input]);
  const router = useMemo(() => squadRouter(input), [input]);
  const routerBot = router ? bots.find((bot) => bot.id === router.botId) : undefined;
  const nameOf = (botId: string) =>
    input.members.find((member) => member.botId === botId)?.name ??
    bots.find((bot) => bot.id === botId)?.name ??
    t`bot`;
  const stateLabel = { waiting: t`Waiting…`, working: t`Working…`, done: t`Done` };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background text-foreground">
      <PageHeader
        width="full"
        leading={
          <Button
            variant="ghost"
            size="icon"
            aria-label={t`Back`}
            onClick={() => navigate(`/app/g/${groupId}`)}
          >
            <ChevronLeft />
          </Button>
        }
      >
        {snapshot?.groupName}
      </PageHeader>

      {thread.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : null}

      {router ? (
        <div
          data-testid="squad-router"
          className="mx-6 mb-4 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
        >
          <BotAvatar color={routerBot?.color ?? ""} identity={router.botId} size={28} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{routerBot?.name ?? t`bot`}</div>
            <div className="text-sm text-muted-foreground">{router.reason ?? router.text}</div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3 px-6 pb-6">
        {lanes.map((lane) => (
          <section
            key={lane.botId}
            data-testid={`squad-lane-${lane.botId}`}
            data-state={lane.state}
            className={`rounded-xl border bg-card p-4 transition-colors ${
              lane.state === "working" ? "border-foreground/40" : "border-border"
            } ${lane.state === "waiting" ? "opacity-70" : ""}`}
          >
            <Button
              variant="ghost"
              className="h-auto w-full justify-start gap-3 p-0 hover:bg-transparent"
              onClick={() => navigate(`/app/${lane.botId}`)}
            >
              <BotAvatar
                color={lane.color}
                identity={lane.botId}
                size={32}
                status={lane.state === "working" ? "running" : undefined}
              />
              <span className="min-w-0 flex-1 truncate text-start text-sm font-medium">
                {lane.name}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {stateLabel[lane.state]}
              </span>
            </Button>
            {lane.handoffIn ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
                <span>↪ {nameOf(lane.handoffIn.fromBotId)}: </span>
                <span>{lane.handoffIn.text}</span>
                {lane.handoffIn.reason ? (
                  <span className="italic"> {lane.handoffIn.reason}</span>
                ) : null}
              </div>
            ) : null}
            {lane.activity.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5 text-sm text-muted-foreground">
                {lane.activity.map((line) => (
                  <li key={line} className="rounded-md bg-muted px-2 py-1">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
