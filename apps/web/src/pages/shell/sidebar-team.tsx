import type { AppBootstrap, Bot, DirectPerson, NavPart, PresenceStatus } from "@corvo/contracts";
import { NAV_PARTS } from "@corvo/contracts";
import { Button, Kbd, Popover, PopoverContent, PopoverTrigger } from "@corvo/ui-web";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  Brain,
  CalendarClock,
  ChevronDown,
  FileText,
  Gauge,
  Home,
  Landmark,
  ListChecks,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { NewDot } from "../../components/NewDot";
import { PeopleList } from "../../components/PeopleList";
import { applyPartnerAccent } from "../../lib/embed";
import { usePresence } from "../../lib/presence";
import { useSpaceQueries } from "../../lib/query";
import { useDirectPeople } from "../../lib/use-direct-people";
import { useMissions } from "../../lib/use-missions";
import { usePendingApprovals } from "../../lib/use-pending-approvals";

const NAV_ITEM =
  "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-start text-nav text-sidebar-foreground/80 outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-sidebar-foreground";

type NavTarget = {
  key: string;
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: number;
  isNew?: boolean;
};

const ICON = { size: 16, strokeWidth: 1.75, "aria-hidden": true, className: "shrink-0" } as const;

/**
 * The places of a space, one line each. Choosing one opens it in the main pane; the channels,
 * agents and people below stay where they are. Everything else sits in the "More" menu.
 */
export function SidebarNav({
  items,
  more,
  pathname,
  onOpen,
  onQuickSwitch,
}: {
  items: readonly NavTarget[];
  more: readonly NavTarget[];
  pathname: string;
  onOpen: (to: string) => void;
  /** Opens the quick switcher (Cmd/Ctrl-K). */
  onQuickSwitch?: () => void;
}) {
  const { t } = useLingui();
  const [moreOpen, setMoreOpen] = useState(false);
  // Routine flows live on a tab of Routines, so the one entry stays lit on both.
  const current = (to: string) =>
    pathname === to || (to === "/app/routines" && pathname === "/app/workflows")
      ? "page"
      : undefined;
  return (
    <nav
      aria-label={t`Space`}
      data-testid="sidebar-nav"
      className="flex flex-col gap-px px-2.5 pb-2"
    >
      {onQuickSwitch ? (
        <button
          type="button"
          data-testid="sidebar-quick-switch"
          onClick={onQuickSwitch}
          className="mb-1.5 flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/40 px-2 text-start text-nav text-muted-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search {...ICON} />
          <span className="min-w-0 flex-1 truncate">{t`Go to…`}</span>
          <Kbd>⌘K</Kbd>
        </button>
      ) : null}
      {items.map(({ key, label, to, icon: Icon, badge, isNew }) => (
        <button
          key={key}
          type="button"
          data-testid={`sidebar-${key}`}
          aria-current={current(to)}
          onClick={() => onOpen(to)}
          className={NAV_ITEM}
        >
          <Icon {...ICON} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge ? (
            <span
              data-testid={`sidebar-${key}-count`}
              className="min-w-5 rounded-full bg-primary px-1.5 text-center text-meta font-semibold tabular-nums text-primary-foreground"
            >
              {badge}
            </span>
          ) : isNew ? (
            <NewDot className="size-2 shrink-0" />
          ) : null}
        </button>
      ))}
      {more.length > 0 ? (
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger
            data-testid="sidebar-more"
            aria-haspopup="menu"
            aria-current={more.some((item) => item.to === pathname) ? "page" : undefined}
            className={NAV_ITEM}
          >
            <span className="min-w-0 flex-1 truncate">{t`More`}</span>
            {more.some((item) => item.isNew) ? <NewDot className="size-2 shrink-0" /> : null}
            <ChevronDown
              size={14}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 text-muted-foreground"
            />
          </PopoverTrigger>
          <PopoverContent side="right" align="start" sideOffset={8} className="w-52 gap-0 p-1">
            {more.map(({ key, label, to, icon: Icon, isNew }) => (
              <Button
                key={key}
                variant="ghost"
                className="h-8 w-full justify-start gap-2.5 text-nav font-normal"
                onClick={() => {
                  setMoreOpen(false);
                  onOpen(to);
                }}
              >
                <Icon {...ICON} className="shrink-0 text-muted-foreground" />
                {label}
                {isNew ? <NewDot className="ms-auto size-2" /> : null}
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

/** Whether this person is one of the platform's operators; undefined until the first bootstrap. */
export function usePartnerAdmin(): boolean | undefined {
  const queries = useSpaceQueries();
  return useQuery({
    ...queries.bootstrap.queryOptions({ input: {} }),
    queryFn: skipToken,
    select: (bootstrap: AppBootstrap) => bootstrap.me?.partnerAdmin === true,
  }).data;
}

/** Paints the partner's own colour, unless the page that embeds Rook brought one. */
export function usePartnerAccent(): void {
  const queries = useSpaceQueries();
  const accent = useQuery({
    ...queries.bootstrap.queryOptions({ input: {} }),
    queryFn: skipToken,
    select: (bootstrap: AppBootstrap) => bootstrap.me?.partner?.accent ?? null,
  }).data;
  useEffect(() => {
    applyPartnerAccent(accent ?? null);
  }, [accent]);
}

/** The nav with what this account may see: its approvals waiting, the parts a mission has brought, and what a partner hides. */
export function SidebarNavLive({
  ticketBoardEnabled,
  embedded,
  onOpen,
  onQuickSwitch,
}: {
  ticketBoardEnabled: boolean;
  embedded: boolean;
  onOpen: (to: string) => void;
  onQuickSwitch?: () => void;
}) {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const missions = useMissions();
  const approvals = usePendingApprovals().data?.length ?? 0;
  const hidden = usePartnerHidden();
  const operator = usePartnerAdmin() === true;
  const visible = (part: NavPart) => !hidden.includes(part) && missions.shows(part);
  const target = (part: NavPart, label: string, to: string, icon: LucideIcon): NavTarget => ({
    key: part,
    label,
    to,
    icon,
    isNew: missions.isNew(part),
  });
  const items: NavTarget[] = [
    { key: "home", label: t`Home`, to: "/app/home", icon: Home },
    {
      key: "approvals",
      label: t`Approvals`,
      to: "/app/approvals",
      icon: ShieldCheck,
      badge: approvals,
    },
    // Tasks is there whenever the board is on: a mission never hides it, only a partner can.
    ...(ticketBoardEnabled && !hidden.includes("board")
      ? [target("board", t`Tasks`, "/app/board", ListChecks)]
      : []),
    ...(visible("routines")
      ? [target("routines", t`Routines`, "/app/routines", CalendarClock)]
      : []),
    { key: "activity", label: t`Activity`, to: "/app/activity", icon: Activity },
    ...(visible("team") ? [target("team", t`Team`, "/app/team", Users)] : []),
  ];
  const more: NavTarget[] = [
    ...(visible("usage") ? [target("usage", t`Usage`, "/app/usage", Gauge)] : []),
    ...(visible("artifacts")
      ? [target("artifacts", t`Artifacts`, "/app/artifacts", FileText)]
      : []),
    ...(visible("wiki") ? [target("wiki", t`Wiki`, "/app/wiki", BookOpen)] : []),
    // Memory is an account setting, which a partner's frame does not offer.
    ...(operator
      ? [{ key: "platform", label: t`Platform`, to: "/app/platform/pricing", icon: Landmark }]
      : []),
    ...(embedded || !visible("memory")
      ? []
      : [target("memory", t`Memory`, "/settings/memory", Brain)]),
  ];
  return (
    <SidebarNav
      items={items}
      more={more}
      pathname={pathname}
      onQuickSwitch={onQuickSwitch}
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
  presence,
}: {
  people: readonly DirectPerson[];
  activeUserId?: string;
  onOpen: (userId: string) => void;
  presence?: ReadonlyMap<string, PresenceStatus>;
}) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2 pt-3 pb-0.5 text-caption font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <Trans>People</Trans>
      </h2>
      <PeopleList people={people} activeUserId={activeUserId} onOpen={onOpen} presence={presence} />
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
  const presence = usePresence();
  return (
    <SidebarPeople
      people={people.data ?? []}
      activeUserId={activeUserId}
      onOpen={onOpen}
      presence={presence}
    />
  );
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
