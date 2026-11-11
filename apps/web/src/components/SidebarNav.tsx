import type { AppBootstrap, NavPart } from "@corvo/contracts";
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
import { isEmbedded } from "../lib/embed";
import { useSpaceQueries } from "../lib/query";
import type { Section } from "../lib/rail-section";
import { railSection } from "../lib/rail-section";
import { useMissions } from "../lib/use-missions";
import { NewDot } from "./NewDot";
import type { RailMoreItem } from "./RailMore";
import { RailMore } from "./RailMore";

const ROW =
  "app-no-drag relative flex w-full items-center rounded-xl text-sm text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-foreground";
const ROW_FULL = `${ROW} h-9 gap-2.5 px-2.5`;
const ROW_MINI = `${ROW} size-9 justify-center`;

/** The short list at the top of the sidebar that moves between Rook's areas. */
export function SidebarNav({
  ticketBoardEnabled,
  mini = false,
  onNavigate,
}: {
  ticketBoardEnabled: boolean;
  /** The collapsed sidebar keeps the icons and drops the names. */
  mini?: boolean;
  /** Called after a place is chosen, so a phone's drawer can close. */
  onNavigate?: () => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const queries = useSpaceQueries();
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
  // Inside a partner's frame the list has every area, but not the account settings: they do not
  // belong in the partner's page.
  const embedded = isEmbedded();
  // The rest of the places sit behind the three dots. Approvals and Memory are account settings,
  // which a partner's frame does not offer.
  const goMore = (part: NavPart, to: string) => () => {
    missions.open(part);
    navigate(to);
    onNavigate?.();
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
  const rowClass = mini ? ROW_MINI : ROW_FULL;
  const place = (
    section: Section,
    label: string,
    to: string,
    Icon: ComponentType<{ className?: string }>,
  ) => (
    <button
      key={section}
      type="button"
      aria-label={label}
      aria-current={active === section ? "page" : undefined}
      onClick={() => {
        if (section !== "agents") missions.open(section);
        navigate(to);
        onNavigate?.();
      }}
      className={rowClass}
    >
      <Icon className="size-[18px] shrink-0" />
      {mini ? null : <span className="min-w-0 flex-1 truncate text-start">{label}</span>}
      {section !== "agents" && missions.isNew(section) ? (
        <NewDot className="absolute end-3 top-3" />
      ) : null}
    </button>
  );
  return (
    <nav
      aria-label={t`Main`}
      data-testid="sidebar-nav"
      className={`flex flex-col gap-0.5 ${mini ? "items-center px-0 pb-2" : "px-2.5 pb-3"}`}
    >
      {items
        .filter(({ section }) => !hidden.includes(section))
        .filter(({ section }) => section === "agents" || missions.shows(section))
        .map(({ section, label, to, Icon }) => place(section, label, to, Icon))}
      {/* The wide sidebar keeps the Store in its footer, beside the account. */}
      {mini && !hidden.includes("store") ? (
        <button
          type="button"
          aria-label={t`Store`}
          onClick={() => {
            navigate("/app?integrations");
            onNavigate?.();
          }}
          className={rowClass}
        >
          <Store className="size-[18px] shrink-0" />
        </button>
      ) : null}
      <RailMore
        items={more}
        active={active === "usage" || active === "artifacts" || active === "wiki"}
        className={rowClass}
        labelClassName={mini ? "hidden" : "min-w-0 flex-1 truncate text-start"}
      />
    </nav>
  );
}
