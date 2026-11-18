import type { Bot, HomeChecklistItemId, PendingApproval } from "@corvo/contracts";
import { BotAvatar, Button, NativeSelect, NativeSelectOption, Textarea } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Check } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Shimmer } from "../components/ai/primitives";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { findFirstBot } from "../lib/first-bot";
import { daypart, routinesCard, waitingCard, workingCard } from "../lib/home-cards";
import { firstName } from "../lib/onboarding-rail";
import { useSpaceQueries } from "../lib/query";
import { useSpaceHint } from "../lib/space-hints";
import { useSpaceRpc } from "../lib/space-rpc";
import { usePendingApprovals } from "../lib/use-pending-approvals";
import { errorText } from "../lib/user-error";

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

function HomeCardFrame({
  title,
  to,
  total,
  testId,
  children,
}: {
  title: string;
  to: string;
  total: number;
  testId: string;
  children: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <section data-testid={testId} className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {total > 0 ? (
          <Link
            to={to}
            className="rounded text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t`See all`}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const rowClass =
  "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1.5 text-sm text-muted-foreground">{children}</p>;
}

function waitingText(item: PendingApproval): string {
  return item.block.kind === "ask" ? item.block.text : "";
}

/**
 * Where the app opens: a greeting, what is left of getting started, a line to ask the Chief (or
 * another agent) for something, and three live cards: what waits on the person, who is working
 * and what runs next.
 */
export function HomePage() {
  const { t, i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const rpc = useSpaceRpc();
  const [now] = useState(() => new Date());

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
  const calendar = useQuery({
    ...queries.routines.calendar.queryOptions({
      input: { from: now.toISOString(), to: new Date(now.getTime() + 7 * DAY_MS).toISOString() },
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
  const next = useMemo(
    () => routinesCard(calendar.data?.occurrences ?? [], now),
    [calendar.data, now],
  );

  const name = firstName(bootstrap?.me.name);
  const part = daypart(now.getHours());
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

  async function send() {
    const message = text.trim();
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

  const list = checklist.data;
  const { done, total } = list ?? { done: 0, total: 0 };
  const agentName = target?.name ?? "";
  const chiefLink = list?.chiefId ?? chief?.id ?? null;
  const checklistLabels: Record<HomeChecklistItemId, string> = {
    talk: t`Talk to an agent`,
    connect: t`Connect a tool`,
    routine: t`Create a routine`,
    invite: t`Invite someone`,
  };

  return (
    <div
      data-testid="home-page"
      className="h-full min-h-0 overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <h1 className="text-[32px] font-medium tracking-tight">{greeting}</h1>

        {list ? (
          <section
            data-testid="home-checklist"
            className="rounded-2xl border border-border bg-card p-4"
          >
            <h2 className="mb-2 text-sm font-medium">
              {t`Pick up where you left off · ${done} of ${total}`}
            </h2>
            <ul className="flex flex-col">
              {list.items.map((item) => (
                <li key={item.id}>
                  <Link to={checklistTarget(item.id, chiefLink)} className={rowClass}>
                    <span
                      aria-hidden
                      className={`grid size-4 shrink-0 place-items-center rounded-full border ${
                        item.done
                          ? "border-foreground bg-foreground text-background"
                          : "border-border"
                      }`}
                    >
                      {item.done ? <Check className="size-3" /> : null}
                    </span>
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>
                      {checklistLabels[item.id]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {target ? (
          <form
            data-testid="home-composer"
            className="rounded-2xl border border-border bg-card p-3 focus-within:border-ring"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Textarea
              aria-label={t`Ask ${agentName} for something`}
              placeholder={t`Ask ${agentName} for something`}
              rows={2}
              value={text}
              disabled={sending}
              className="resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              {bots.length > 1 ? (
                <NativeSelect
                  size="sm"
                  aria-label={t`Agent`}
                  value={target.id}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  {bots.map((bot) => (
                    <NativeSelectOption key={bot.id} value={bot.id}>
                      {bot.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              ) : (
                <span />
              )}
              <Button
                type="submit"
                size="icon"
                aria-label={t`Send`}
                disabled={sending || text.trim().length === 0}
              >
                <ArrowUp aria-hidden />
              </Button>
            </div>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <HomeCardFrame
            title={t`Waiting for you`}
            to="/app/approvals"
            total={waiting.total}
            testId="home-waiting"
          >
            {waiting.items.length === 0 ? (
              <Empty>{t`Nothing to approve`}</Empty>
            ) : (
              <ul className="flex flex-col">
                {waiting.items.map((item) => (
                  <li
                    key={`${item.messageId}:${item.block.kind === "ask" ? item.block.approvalEffectId : ""}`}
                  >
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() =>
                        navigate(item.groupId ? `/app/g/${item.groupId}` : `/app/${item.botId}`)
                      }
                    >
                      <BotAvatar color={item.botColor} identity={item.botId} size={20} />
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{item.botName}</span>
                        <span className="text-muted-foreground"> {waitingText(item)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </HomeCardFrame>

          <HomeCardFrame
            title={t`Working now`}
            to="/app/activity"
            total={working.total}
            testId="home-working"
          >
            {working.items.length === 0 ? (
              <Empty>{t`Nothing running`}</Empty>
            ) : (
              <ul className="flex flex-col">
                {working.items.map((run) => (
                  <li key={run.runId}>
                    <button
                      type="button"
                      className={rowClass}
                      onClick={() =>
                        navigate(run.groupId ? `/app/g/${run.groupId}` : `/app/${run.botId}`)
                      }
                    >
                      <span className="min-w-0 truncate">
                        <span className="font-medium">{run.botName}</span>{" "}
                        <Shimmer>{run.promptSnippet || t`Working`}</Shimmer>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </HomeCardFrame>

          <HomeCardFrame
            title={t`Next routines`}
            to="/app/routines"
            total={next.total}
            testId="home-routines"
          >
            {next.items.length === 0 ? (
              <Empty>{t`No routines scheduled`}</Empty>
            ) : (
              <ul className="flex flex-col">
                {next.items.map((entry) => (
                  <li key={`${entry.routineId}:${entry.at}`}>
                    <Link to="/app/routines" className={rowClass}>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(entry.at).toLocaleString(i18n.locale || "en", {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </HomeCardFrame>
        </div>
      </div>
    </div>
  );
}
