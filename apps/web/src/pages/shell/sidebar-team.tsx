import type { Bot, DirectPerson } from "@corvo/contracts";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComponentProps } from "react";
import { PeopleList } from "../../components/PeopleList";
import { useDirectPeople } from "../../lib/use-direct-people";
import { usePendingApprovals } from "../../lib/use-pending-approvals";

const NAV_ITEM =
  "flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring  aria-pressed:bg-sidebar-accent";

/**
 * The places of a space, one line each: home, what waits on this person (always listed, its count
 * only while something waits), the conversations, the board where there is one, and the team.
 */
export function SidebarNav({
  approvals,
  conversationsOn,
  showTasks,
  onHome,
  onApprovals,
  onConversations,
  onTasks,
  onTeam,
}: {
  approvals: number;
  conversationsOn: boolean;
  showTasks: boolean;
  onHome: () => void;
  onApprovals: () => void;
  onConversations: () => void;
  onTasks: () => void;
  onTeam: () => void;
}) {
  return (
    <nav
      aria-label={t`Space`}
      data-testid="sidebar-nav"
      className="flex flex-col gap-0.5 px-2.5 pb-3"
    >
      <button type="button" data-testid="sidebar-home" onClick={onHome} className={NAV_ITEM}>
        <Trans>Home</Trans>
      </button>
      <button
        type="button"
        data-testid="sidebar-approvals"
        onClick={onApprovals}
        className={NAV_ITEM}
      >
        <Trans>Approvals</Trans>
        {approvals > 0 ? (
          <span
            data-testid="sidebar-approvals-count"
            className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold tabular-nums text-primary-foreground"
          >
            {approvals}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        data-testid="sidebar-conversations"
        aria-pressed={conversationsOn}
        onClick={onConversations}
        className={NAV_ITEM}
      >
        <Trans>Conversations</Trans>
      </button>
      {showTasks ? (
        <button type="button" data-testid="sidebar-tasks" onClick={onTasks} className={NAV_ITEM}>
          <Trans>Tasks</Trans>
        </button>
      ) : null}
      <button type="button" data-testid="sidebar-team" onClick={onTeam} className={NAV_ITEM}>
        <Trans>Team</Trans>
      </button>
    </nav>
  );
}

/** The nav block with its approval count read live. */
export function SidebarNavLive(props: Omit<ComponentProps<typeof SidebarNav>, "approvals">) {
  const approvals = usePendingApprovals();
  return <SidebarNav {...props} approvals={approvals.data?.length ?? 0} />;
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
