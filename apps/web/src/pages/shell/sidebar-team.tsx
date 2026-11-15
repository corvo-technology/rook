import type { Bot, DirectPerson } from "@corvo/contracts";
import { plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ShieldCheck } from "lucide-react";
import { PeopleList } from "../../components/PeopleList";
import { useDirectPeople } from "../../lib/use-direct-people";
import { usePendingApprovals } from "../../lib/use-pending-approvals";

/** The way to what waits on this person; it appears only while something does. */
export function SidebarApprovals({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      data-testid="sidebar-approvals"
      onClick={onOpen}
      className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-start text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ShieldCheck size={16} strokeWidth={1.8} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <Trans>Approvals</Trans>
      </span>
      <span
        data-testid="sidebar-approvals-count"
        className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-semibold tabular-nums text-primary-foreground"
      >
        {count}
      </span>
    </button>
  );
}

export function SidebarApprovalsLink({ onOpen }: { onOpen: () => void }) {
  const approvals = usePendingApprovals();
  return <SidebarApprovals count={approvals.data?.length ?? 0} onOpen={onOpen} />;
}

/** The space's other people, each a conversation. A space of one has no one to write to. */
export function SidebarPeople({
  people,
  onOpen,
}: {
  people: readonly DirectPerson[];
  onOpen: (userId: string) => void;
}) {
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2.5 pt-3 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-foreground">
        <Trans>People</Trans>
      </h2>
      <PeopleList people={people} onOpen={onOpen} />
    </div>
  );
}

export function SidebarPeopleList({ onOpen }: { onOpen: (userId: string) => void }) {
  const people = useDirectPeople();
  return <SidebarPeople people={people.data ?? []} onOpen={onOpen} />;
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
