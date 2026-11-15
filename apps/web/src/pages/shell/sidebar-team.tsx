import type { AppBootstrap, Bot, DirectPerson, NavPart } from "@corvo/contracts";
import { NAV_PARTS } from "@corvo/contracts";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { NewDot } from "../../components/NewDot";
import { PeopleList } from "../../components/PeopleList";
import { findFirstBot } from "../../lib/first-bot";
import { useSpaceQueries } from "../../lib/query";
import { useDirectPeople } from "../../lib/use-direct-people";
import { useMissions } from "../../lib/use-missions";
import { usePendingApprovals } from "../../lib/use-pending-approvals";

const NAV_ITEM =
  "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium";

type NavTarget = { key: string; label: string; to: string; badge?: number; isNew?: boolean };

/**
 * The places of a space, one line each. Choosing one opens it in the main pane; the channels,
 * agents and people below stay where they are. Everything else sits behind "More".
 */
export function SidebarNav({
  items,
  more,
  pathname,
  onOpen,
}: {
  items: readonly NavTarget[];
  more: readonly NavTarget[];
  pathname: string;
  onOpen: (to: string) => void;
}) {
  const { t } = useLingui();
  const [moreOpen, setMoreOpen] = useState(false);
  const current = (to: string) => (pathname === to ? "page" : undefined);
  return (
    <nav
      aria-label={t`Space`}
      data-testid="sidebar-nav"
      className="flex flex-col gap-0.5 px-2.5 pb-3"
    >
      {items.map(({ key, label, to, badge, isNew }) => (
        <button
          key={key}
          type="button"
          data-testid={`sidebar-${key}`}
          aria-current={current(to)}
          onClick={() => onOpen(to)}
          className={NAV_ITEM}
        >
          {label}
          {badge ? (
            <span
              data-testid={`sidebar-${key}-count`}
              className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold tabular-nums text-primary-foreground"
            >
              {badge}
            </span>
          ) : isNew ? (
            <NewDot />
          ) : null}
        </button>
      ))}
      {more.length > 0 ? (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            data-testid="sidebar-more"
            aria-current={more.some((item) => item.to === pathname) ? "page" : undefined}
            className={NAV_ITEM}
          >
            {t`More`}
            {more.some((item) => item.isNew) ? <NewDot /> : null}
          </PopoverTrigger>
          <PopoverContent side="right" align="start" sideOffset={8} className="w-52 gap-0 p-1">
            {more.map(({ key, label, to, isNew }) => (
              <Button
                key={key}
                variant="ghost"
                className="h-9 w-full justify-start gap-2.5 font-normal"
                onClick={() => {
                  setMoreOpen(false);
                  onOpen(to);
                }}
              >
                {label}
                {isNew ? <NewDot className="ms-auto" /> : null}
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </nav>
  );
}

/** What a partner leaves out for its customers, read from what the screen already loaded. */
export function usePartnerHidden(): readonly string[] {
  const queries = useSpaceQueries();
  return (
    useQuery({
      ...queries.bootstrap.queryOptions({ input: {} }),
      // The nav never fetches the first bootstrap; the screen beside it needs that for itself.
      queryFn: skipToken,
      select: (bootstrap: AppBootstrap) => bootstrap.me?.partner?.hide ?? [],
    }).data ?? []
  );
}

/** The nav with what this account may see: its approvals waiting, the parts a mission has brought, and what a partner hides. */
export function SidebarNavLive({
  bots,
  ticketBoardEnabled,
  embedded,
  onOpen,
}: {
  bots: readonly Bot[];
  ticketBoardEnabled: boolean;
  embedded: boolean;
  onOpen: (to: string) => void;
}) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const missions = useMissions();
  const approvals = usePendingApprovals().data?.length ?? 0;
  const hidden = usePartnerHidden();
  const staff = bots.filter((bot) => !bot.archivedAt);
  // Home is the Chief's chat, or the first agent's where an older account has none.
  const chief =
    findFirstBot(staff.map((bot) => ({ ...bot, spawnKey: bot.spawnKey ?? null }))) ?? staff[0];
  const visible = (part: NavPart) => !hidden.includes(part) && missions.shows(part);
  const target = (part: NavPart, label: string, to: string): NavTarget => ({
    key: part,
    label,
    to,
    isNew: missions.isNew(part),
  });
  const items: NavTarget[] = [
    { key: "home", label: t`Home`, to: chief ? `/app/${chief.id}` : "/app" },
    { key: "approvals", label: t`Approvals`, to: "/app/approvals", badge: approvals },
    ...(ticketBoardEnabled && visible("board") ? [target("board", t`Tasks`, "/app/board")] : []),
    ...(visible("routines") ? [target("routines", t`Routines`, "/app/routines")] : []),
    { key: "activity", label: t`Activity`, to: "/app/activity" },
    ...(visible("team") ? [target("team", t`Team`, "/app/team")] : []),
  ];
  const more: NavTarget[] = [
    ...(visible("workflows") ? [target("workflows", t`Workflows`, "/app/workflows")] : []),
    ...(visible("usage") ? [target("usage", t`Usage`, "/app/usage")] : []),
    ...(visible("artifacts") ? [target("artifacts", t`Artifacts`, "/app/artifacts")] : []),
    ...(visible("wiki") ? [target("wiki", t`Wiki`, "/app/wiki")] : []),
    // Memory is an account setting, which a partner's frame does not offer.
    ...(embedded || !visible("memory") ? [] : [target("memory", t`Memory`, "/settings/memory")]),
  ];
  return (
    <SidebarNav
      items={items}
      more={more}
      pathname={pathname}
      onOpen={(to) => {
        const part = [...items, ...more].find((item) => item.to === to)?.key;
        if (part && NAV_PARTS.includes(part as NavPart)) missions.open(part as NavPart);
        onOpen(to);
      }}
    />
  );
}

/** The space's other people, each a conversation. A space of one has no one to write to. */
export function SidebarPeople({
  people,
  activeUserId,
  onOpen,
}: {
  people: readonly DirectPerson[];
  activeUserId?: string;
  onOpen: (userId: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2.5 pt-3 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Trans>People</Trans>
      </h2>
      <PeopleList people={people} activeUserId={activeUserId} onOpen={onOpen} />
    </div>
  );
}

export function SidebarPeopleList({
  activeUserId,
  onOpen,
}: {
  activeUserId?: string;
  onOpen: (userId: string) => void;
}) {
  const people = useDirectPeople();
  return <SidebarPeople people={people.data ?? []} activeUserId={activeUserId} onOpen={onOpen} />;
}

/** "3 people · 6 agents" under the space's name; a space of one person needs no count. */
export function useSpaceSummary(bots: readonly Pick<Bot, "archivedAt">[]): string | undefined {
  const others = useDirectPeople().data?.length ?? 0;
  if (others === 0) return undefined;
  const people = others + 1;
  const agents = bots.filter((bot) => !bot.archivedAt).length;
  const peopleLabel = plural(people, { one: "# person", other: "# people" });
  const agentsLabel = plural(agents, { one: "# agent", other: "# agents" });
  return `${peopleLabel} · ${agentsLabel}`;
}
