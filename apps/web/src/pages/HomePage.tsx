import type { Bot, HomeChecklistItemId } from "@corvo/contracts";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { isEmbedded, openInHost } from "../lib/embed";
import { quickActions } from "../lib/embedded-home";
import { findFirstBot } from "../lib/first-bot";
import { daypart, routinesCard, waitingCard, workingCard } from "../lib/home-cards";
import { greetingName, statusCounts, timelineGroups } from "../lib/home-live";
import type { HomeCardId } from "../lib/home-prefs";
import {
  moveCard,
  readHomeLayout,
  readStartPage,
  setCardHidden,
  writeHomeLayout,
  writeStartPage,
} from "../lib/home-prefs";
import { useSpaceQueries } from "../lib/query";
import { useSpaceHint } from "../lib/space-hints";
import { useSpaceRpc } from "../lib/space-rpc";
import { usePendingApprovals } from "../lib/use-pending-approvals";
import { errorText } from "../lib/user-error";
import { ChecklistStrip } from "./home/ChecklistStrip";
import { EmbeddedHome } from "./home/EmbeddedHome";
import { cardLink, HomeCard } from "./home/HomeCard";
import { HomeComposer } from "./home/HomeComposer";
import { HomeHero } from "./home/HomeHero";
import { useNow } from "./home/hooks";
import { usePartnerBalance } from "./home/PartnerBalance";
import { RoutineTimeline } from "./home/RoutineTimeline";
import { WaitingList } from "./home/WaitingList";
import { WorkingFeed } from "./home/WorkingFeed";
import { EmbedHomeSkeleton } from "./shell/embed-tabs";
import "./home/home.css";

const NO_BOTS: Bot[] = [];
const DAY_MS = 24 * 60 * 60_000;
const POLL_MS = 15_000;

/** Where each getting-started item leads, given the Chief's chat. */
function checklistTarget(id: HomeChecklistItemId, chiefId: string | null): string {
  switch (id) {
    case "talk":
      return chiefId ? `/app/${chiefId}` : "/app";
    case "connect":
      return "/settings/connections";
    case "routine":
      return "/app/routines";
    case "invite":
      return "/settings/members";
  }
}

const rise = (i: number) => ({ "--rk-i": i }) as React.CSSProperties;

/**
 * Where the app opens: a greeting with one live line of what the team is doing, a prompt to give
 * work to the Chief (or another agent), and live activity: who is working, what waits on the
 * person and what runs next.
 */
export function HomePage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const [opened] = useState(() => new Date());
  const tick = useNow(30_000);
  const now = useMemo(() => new Date(Math.max(tick, opened.getTime())), [tick, opened]);

  const bootstrap = useQuery({
    queryKey: queries.bootstrap.queryKey({ input: {} }),
    queryFn: () => takeInitialBootstrap(),
  }).data;
  const bots = bootstrap?.bots.filter((bot) => !bot.archivedAt) ?? NO_BOTS;
  const chiefId = findFirstBot(bots.map((bot) => ({ ...bot, spawnKey: bot.spawnKey ?? null })))?.id;
  const chief = bots.find((bot) => bot.id === chiefId) ?? bots[0];

  const approvals = usePendingApprovals();
  const runs = useQuery({
    ...queries.runs.list.queryOptions({ input: { filter: "active" } }),
    refetchInterval: POLL_MS,
  });
  const dayStart = useMemo(
    () => new Date(opened.getFullYear(), opened.getMonth(), opened.getDate()),
    [opened],
  );
  const calendar = useQuery({
    ...queries.routines.calendar.queryOptions({
      input: {
        from: dayStart.toISOString(),
        to: new Date(dayStart.getTime() + 2 * DAY_MS).toISOString(),
      },
    }),
    refetchInterval: POLL_MS * 4,
  });
  const checklist = useQuery({
    ...queries.home.checklist.queryOptions({ input: undefined }),
    refetchInterval: POLL_MS * 4,
  });
  // The streams say when a list changed; each card reads again then.
  useSpaceHint("routines", () => void calendar.refetch());
  useSpaceHint("notifications", () => {
    void runs.refetch();
    void checklist.refetch();
  });
  useSpaceHint("roster", () => void checklist.refetch());

  const waiting = useMemo(() => waitingCard(approvals.data ?? []), [approvals.data]);
  const working = useMemo(() => workingCard(runs.data?.runs ?? []), [runs.data]);
  const occurrences = calendar.data?.occurrences;
  const timeline = useMemo(() => timelineGroups(occurrences ?? [], now), [occurrences, now]);
  const upcoming = useMemo(() => routinesCard(occurrences ?? [], now), [occurrences, now]);
  const status = statusCounts({
    workingTotal: working.total,
    waitingTotal: waiting.total,
    upcoming: upcoming.items,
    now,
  });

  const name = greetingName({ name: bootstrap?.me.name, email: bootstrap?.me.email });
  const part = daypart(opened.getHours());
  const greeting = name
    ? part === "morning"
      ? t`Good morning, ${name}`
      : part === "afternoon"
        ? t`Good afternoon, ${name}`
        : t`Good evening, ${name}`
    : part === "morning"
      ? t`Good morning`
      : part === "afternoon"
        ? t`Good afternoon`
        : t`Good evening`;

  const [agentId, setAgentId] = useState<string | null>(null);
  const target = bots.find((bot) => bot.id === agentId) ?? chief;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  async function send(override?: string) {
    const message = (override ?? text).trim();
    if (!message || !target || sending) return;
    setSending(true);
    setError(null);
    try {
      await rpc.threads.send({
        botId: target.id,
        text: message,
        imageHandling: "confirm",
        clientNonce: crypto.randomUUID(),
      });
      navigate(`/app/${target.id}`);
    } catch (err) {
      setError(errorText(err, t`Could not send`));
      setSending(false);
    }
  }

  const balance = usePartnerBalance();
  const list = checklist.data;
  const chiefLink = list?.chiefId ?? chief?.id ?? null;
  const checklistLabels: Record<HomeChecklistItemId, string> = {
    talk: t`Talk to an agent`,
    connect: t`Connect a tool`,
    routine: t`Create a routine`,
    invite: t`Invite someone`,
  };

  const userId = bootstrap?.me.userId;
  const [start, setStart] = useState(() => readStartPage(userId));
  const [layout, setLayout] = useState(() => readHomeLayout(userId));
  const [organizing, setOrganizing] = useState(false);
  // The person is known once the bootstrap lands; read their choices then.
  useEffect(() => {
    setStart(readStartPage(userId));
    setLayout(readHomeLayout(userId));
  }, [userId]);
  const update = (next: typeof layout) => {
    setLayout(next);
    writeHomeLayout(userId, next);
  };
  const shown = layout.order.filter((id) => !layout.hidden.includes(id));
  const cardTitles: Record<HomeCardId, string> = {
    waiting: t`Waiting for you`,
    working: t`Working now`,
    routines: t`Next routines`,
  };
  const body: Record<HomeCardId, React.ReactNode> = {
    waiting: <WaitingList items={waiting.items} />,
    working: (
      <WorkingFeed runs={working.items} bots={bots} onGiveWork={() => input.current?.focus()} />
    ),
    routines: (
      <RoutineTimeline timeline={timeline} bots={bots} now={now} locale={i18n.locale || "en"} />
    ),
  };
  const action: Partial<Record<HomeCardId, React.ReactNode>> = {
    waiting:
      waiting.total > 0 ? (
        <button type="button" className={cardLink} onClick={() => navigate("/app/approvals")}>
          {t`See all`}
        </button>
      ) : null,
    working:
      working.total > 0 ? (
        <button type="button" className={cardLink} onClick={() => navigate("/app/activity")}>
          {t`Open in manager`}
        </button>
      ) : null,
    routines:
      timeline.today.length + timeline.tomorrow.length > 0 ? (
        <button type="button" className={cardLink} onClick={() => navigate("/app/routines")}>
          {t`See all`}
        </button>
      ) : null,
  };
  const testIds: Record<HomeCardId, string> = {
    waiting: "home-waiting",
    working: "home-working",
    routines: "home-routines",
  };

  if (isEmbedded()) {
    if (!bootstrap?.me.partner) return <EmbedHomeSkeleton />;
    return (
      <EmbeddedHome
        greeting={greeting}
        actions={quickActions(bootstrap.me.partner, bots, chiefId)}
        onAction={(action) => {
          if (action.open) openInHost(action.open);
          else if (action.prompt) void send(action.prompt);
        }}
        composer={
          target ? (
            <HomeComposer
              bots={bots}
              target={target}
              onTarget={setAgentId}
              text={text}
              onText={setText}
              sending={sending}
              error={error}
              onSend={() => void send()}
              inputRef={input}
              suggestions={false}
            />
          ) : null
        }
        waiting={waiting}
        working={working}
        bots={bots}
        balance={balance}
        locale={i18n.locale || "en"}
        onGiveWork={() => input.current?.focus()}
      />
    );
  }

  return (
    <div
      data-testid="home-page"
      className="relative h-full min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div
        aria-hidden
        className="rk-home-dots pointer-events-none absolute inset-x-0 top-0 h-100"
      />
      <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-10 sm:py-14">
        <div className="rk-home-rise" style={rise(0)}>
          <HomeHero
            greeting={greeting}
            status={status}
            start={start}
            onStart={(page) => {
              setStart(page);
              writeStartPage(userId, page);
            }}
          />
        </div>

        {list ? (
          <div className="rk-home-rise" style={rise(1)}>
            <ChecklistStrip
              list={list}
              chief={chief}
              labels={checklistLabels}
              target={(id) => checklistTarget(id, chiefLink)}
            />
          </div>
        ) : null}

        {target ? (
          <div className="rk-home-rise" style={rise(2)}>
            <HomeComposer
              bots={bots}
              target={target}
              onTarget={setAgentId}
              text={text}
              onText={setText}
              sending={sending}
              error={error}
              onSend={() => void send()}
              inputRef={input}
            />
          </div>
        ) : null}

        <section className="rk-home-rise flex flex-col gap-4" style={rise(3)}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">{t`My Home`}</h2>
            <div className="flex items-center rounded-full border border-border bg-card p-0.5 text-sm">
              <button
                type="button"
                aria-pressed={organizing}
                data-testid="home-organize"
                className={`rounded-full px-3 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  organizing ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                }`}
                onClick={() => setOrganizing((value) => !value)}
              >
                {organizing ? t`Done` : t`Organize`}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  disabled={layout.hidden.length === 0}
                  aria-label={t`Add widget`}
                  className="flex items-center gap-1 rounded-full px-3 py-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {t`Widget`}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {layout.hidden.map((id) => (
                    <DropdownMenuItem
                      key={id}
                      onClick={() => update(setCardHidden(layout, id, false))}
                    >
                      {cardTitles[id]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div className="grid items-stretch gap-4 md:grid-cols-2">
            {shown.map((id, index) => (
              <div
                key={id}
                className={`rk-home-rise flex flex-col ${id === "routines" ? "md:col-span-2" : ""}`}
                style={rise(4 + index)}
              >
                <HomeCard
                  className="flex-1"
                  testId={testIds[id]}
                  name={cardTitles[id]}
                  title={
                    <>
                      {cardTitles[id]}
                      {id === "waiting" && waiting.total > 0 ? (
                        <Badge className="bg-brand font-mono text-brand-foreground tabular-nums">
                          {waiting.total}
                        </Badge>
                      ) : null}
                    </>
                  }
                  action={action[id]}
                  band={id !== "routines"}
                  organizing={organizing}
                  onMove={(by) => update(moveCard(layout, id, by))}
                  onHide={() => update(setCardHidden(layout, id, true))}
                >
                  {body[id]}
                </HomeCard>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
