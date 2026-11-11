import type { AppBootstrap, NavLink as AppNavLink, NavPart } from "@corvo/contracts";
import { useLingui } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  FolderOpen,
  Gauge,
  KanbanSquare,
  ShieldCheck,
  Store,
  Users,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";
import { isEmbedded } from "../lib/embed";
import { useSpaceQueries } from "../lib/query";
import type { Section } from "../lib/rail-section";
import { railSection } from "../lib/rail-section";
import { useMissions } from "../lib/use-missions";
import { ShellSidebarFooter } from "../pages/shell/shell-sidebar";
import { WindowChrome } from "../pages/WindowChrome";
import { NewDot } from "./NewDot";
import type { RailMoreItem } from "./RailMore";
import { RailMore } from "./RailMore";
import { SubscriptionRailRings } from "./SubscriptionRings";

/** An area with its name under the icon: people who are new to the app should not have to hover to learn it. */
const RAIL_ITEM =
  "app-no-drag relative flex min-h-14 w-16 flex-col items-center justify-start gap-1 rounded-2xl px-1 pt-2.5 pb-2 text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 ease-out hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100";
const RAIL_LABEL = "text-caption line-clamp-2 w-full text-center leading-3 break-words";

/** The narrow bar that moves between Rook's areas; only agents bring the wide list with them. */
export function AppRail({ ticketBoardEnabled }: { ticketBoardEnabled: boolean }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const queries = useSpaceQueries();
  const session = authClient.useSession();
  const navLinks: AppNavLink[] =
    useQuery({
      ...queries.bootstrap.queryOptions({ input: {} }),
      // Reads what the screen beside the bar already loaded; the bar never fetches, because
      // taking the first bootstrap here would make the agents screen request it a second time.
      queryFn: skipToken,
      select: (bootstrap: AppBootstrap) => bootstrap.me?.navLinks ?? [],
    }).data ?? [];
  const hidden: readonly string[] =
    useQuery({
      ...queries.bootstrap.queryOptions({ input: {} }),
      queryFn: skipToken,
      select: (bootstrap: AppBootstrap) => bootstrap.me?.partner?.hide ?? [],
    }).data ?? [];
  const missions = useMissions();
  const active = railSection(pathname, search);
  const items: Array<{
    section: Section;
    label: string;
    to: string;
    Icon: ComponentType<{ className?: string }>;
  }> = [
    { section: "agents", label: t`Agents`, to: "/app", Icon: Bot },
    // The board is optional: it has a place only where the deployment turns it on.
    ...(ticketBoardEnabled
      ? [{ section: "board" as const, label: t`Board`, to: "/app/board", Icon: KanbanSquare }]
      : []),
    { section: "team", label: t`Team`, to: "/app/team", Icon: Users },
    { section: "routines", label: t`Routines`, to: "/app/routines", Icon: CalendarClock },
    { section: "workflows", label: t`Workflows`, to: "/app/workflows", Icon: Workflow },
  ];
  // Inside a partner's frame the bar has every area, but not the account menu: signing out or
  // opening account settings does not belong in the partner's page.
  const embedded = isEmbedded();
  // The rest of the places sit behind the three dots. Approvals and Memory are account settings,
  // which a partner's frame does not offer.
  const goMore = (part: NavPart, to: string) => () => {
    missions.open(part);
    navigate(to);
  };
  const more: RailMoreItem[] = [
    { key: "usage", label: t`Usage`, Icon: Gauge, onSelect: goMore("usage", "/app/usage") },
    {
      key: "artifacts",
      label: t`Artifacts`,
      Icon: FolderOpen,
      onSelect: goMore("artifacts", "/app/artifacts"),
    },
    { key: "wiki", label: t`Wiki`, Icon: BookOpen, onSelect: goMore("wiki", "/app/wiki") },
    ...(embedded
      ? []
      : [
          {
            key: "approvals",
            label: t`Approvals`,
            Icon: ShieldCheck,
            onSelect: goMore("approvals", "/app?settings=confirmations"),
          },
          {
            key: "memory",
            label: t`Memory`,
            Icon: Brain,
            onSelect: goMore("memory", "/app?settings=memory"),
          },
        ]),
  ]
    .filter((item) => !hidden.includes(item.key))
    .filter((item) => missions.shows(item.key as NavPart))
    .map((item) => ({ ...item, isNew: missions.isNew(item.key as NavPart) }));
  return (
    <nav
      aria-label={t`Main`}
      data-testid="app-rail"
      className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-e border-sidebar-border bg-sidebar pb-2 pt-4 md:flex"
    >
      <div className="app-drag mb-2 flex h-6 items-center">
        <WindowChrome />
      </div>
      {items
        .filter(({ section }) => !hidden.includes(section))
        .filter(({ section }) => section === "agents" || missions.shows(section))
        .map(({ section, label, to, Icon }) => (
          <button
            key={section}
            type="button"
            aria-label={label}
            aria-current={active === section ? "page" : undefined}
            onClick={() => {
              if (section !== "agents") missions.open(section);
              navigate(to);
            }}
            className={`${RAIL_ITEM} aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground`}
          >
            <Icon
              strokeWidth={1.6}
              className="size-5 transition-transform duration-150 ease-out motion-reduce:transition-none"
            />
            <span aria-hidden className={RAIL_LABEL}>
              {label}
            </span>
            {section !== "agents" && missions.isNew(section) ? <NewDot /> : null}
          </button>
        ))}
      <RailMore
        items={more}
        active={active === "usage" || active === "artifacts" || active === "wiki"}
        className={`${RAIL_ITEM} aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground`}
        labelClassName={RAIL_LABEL}
      />
      <div className="mt-auto flex flex-col items-center gap-1">
        {embedded ? null : <SubscriptionRailRings />}
        {hidden.includes("store") ? null : (
          <button
            type="button"
            aria-label={t`Store`}
            onClick={() => navigate("/app?integrations")}
            className={RAIL_ITEM}
          >
            <Store className="size-5" />
            <span aria-hidden className={RAIL_LABEL}>
              {t`Store`}
            </span>
          </button>
        )}
        {embedded ? null : (
          <ShellSidebarFooter
            mini
            account
            logos={[]}
            user={session.data?.user}
            // The rail has its own Board, so the account menu does not repeat it.
            ticketBoardEnabled={false}
            navLinks={navLinks}
            closeMobileSidebar={() => {}}
            navigate={navigate}
            openSettings={(section) => navigate(`/app?settings=${section}`)}
            openIntegrations={() => navigate("/app?integrations")}
          />
        )}
      </div>
    </nav>
  );
}
