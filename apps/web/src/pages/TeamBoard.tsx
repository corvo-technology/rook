import type { SpaceBot, Ticket } from "@corvo/contracts";
import { BotAvatar, Button, RookGlyph } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { formatRelativeTime } from "../lib/relative-time";
import { rosterAttentionLabel, rosterWorkStatusLabel } from "../lib/roster-status";
import type { Team, TeamMember } from "../lib/team-roster";
import { botNeedsYou } from "../lib/team-roster";

export type TeamBoardRoster = {
  chief: SpaceBot | undefined;
  teams: Team[];
  unassigned: SpaceBot[];
};

/**
 * The whole company: the Chief that leads it, each team as a panel with its purpose, who is in it
 * and what each one is doing, and the agents that belong to no team yet. It is a picture of the
 * moment: what is shown is what is in `roster`.
 */
export function TeamBoard({
  roster,
  tickets,
  onOpen,
}: {
  roster: TeamBoardRoster;
  /** What each agent is working on, by agent id. */
  tickets?: ReadonlyMap<string, readonly Ticket[]>;
  onOpen: (path: string) => void;
}) {
  const { t } = useLingui();
  const asMember = (bot: SpaceBot): TeamMember => ({
    bot,
    working: rosterWorkStatusLabel(bot.status) !== null,
    needsYou: botNeedsYou(bot.status),
  });
  if (!roster.chief && roster.teams.length === 0 && roster.unassigned.length === 0) {
    return (
      <p
        data-testid="team-empty"
        className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground"
      >
        <RookGlyph state="asleep" size={36} />
        {t`No bots`}
      </p>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {roster.chief ? (
        <MemberButton
          member={asMember(roster.chief)}
          lead
          testId="team-chief"
          onOpen={() => onOpen(`/app/${roster.chief?.id}`)}
        />
      ) : null}
      {/* Columns, not rows, so a short team fills the space under another and none leaves a gap. */}
      <ul className="flex flex-col gap-8">
        {roster.teams.map((team) => (
          <li key={team.group.id}>
            <Panel
              testId={`team-${team.group.id}`}
              name={team.group.name}
              purpose={team.group.purpose}
              count={team.members.length}
              working={team.working}
              onOpenTeam={() => onOpen(`/app/g/${team.group.id}/squad`)}
            >
              {team.members.map((member) => (
                <div key={member.bot.id}>
                  <MemberButton
                    member={member}
                    testId={`member-${member.bot.id}`}
                    onOpen={() => onOpen(`/app/${member.bot.id}`)}
                  />
                  <MemberTickets
                    tickets={tickets?.get(member.bot.id)}
                    botId={member.bot.id}
                    onOpen={onOpen}
                  />
                </div>
              ))}
            </Panel>
          </li>
        ))}
        {roster.unassigned.length > 0 ? (
          <li>
            <Panel
              testId="team-unassigned"
              name={t`Not in a team`}
              count={roster.unassigned.length}
              working={roster.unassigned.filter((bot) => asMember(bot).working).length}
            >
              {roster.unassigned.map((bot) => (
                <div key={bot.id}>
                  <MemberButton
                    member={asMember(bot)}
                    testId={`member-${bot.id}`}
                    onOpen={() => onOpen(`/app/${bot.id}`)}
                  />
                  <MemberTickets tickets={tickets?.get(bot.id)} botId={bot.id} onOpen={onOpen} />
                </div>
              ))}
            </Panel>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function Panel({
  testId,
  name,
  purpose,
  count,
  working,
  onOpenTeam,
  children,
}: {
  testId: string;
  name: string;
  purpose?: string | null;
  count: number;
  working: number;
  onOpenTeam?: () => void;
  children: ReactNode;
}) {
  const { t } = useLingui();
  const title = (
    <>
      <span className="flex items-baseline gap-2">
        <span className="truncate text-sm font-medium text-foreground" dir="auto">
          {name}
        </span>
        <span className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
          {count > 1 ? <span className="font-mono tabular-nums">{t`${count} agents`}</span> : null}
          {working > 0 ? (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="corvo-presence-dot size-1.5 shrink-0 rounded-full bg-status-working"
              />
              {t`${working} working`}
            </span>
          ) : null}
        </span>
      </span>
      {purpose ? (
        <span
          dir="auto"
          className="mt-0.5 line-clamp-2 block text-[13px] font-normal text-muted-foreground"
        >
          {purpose}
        </span>
      ) : null}
    </>
  );
  return (
    <section data-testid={testId} aria-label={name} className="flex flex-col">
      {onOpenTeam ? (
        <Button
          variant="ghost"
          className="h-auto w-full flex-col items-start justify-start rounded-xl px-3 py-1.5 text-start whitespace-normal"
          onClick={onOpenTeam}
        >
          {title}
        </Button>
      ) : (
        <div className="px-3 py-1.5">{title}</div>
      )}
      <div className="mt-1 flex flex-col divide-y divide-border/50">{children}</div>
    </section>
  );
}

/** What an agent is doing, in one short line: its state when it has one, else when it last was. */
function stateOf(member: TeamMember): { text: string; tone: "working" | "attention" | "idle" } {
  const { bot } = member;
  const attention = rosterAttentionLabel(bot.status);
  if (attention) return { text: attention, tone: "attention" };
  const work = rosterWorkStatusLabel(bot.status);
  if (work) return { text: work, tone: "working" };
  return { text: formatRelativeTime(bot.updatedAt), tone: "idle" };
}

function MemberButton({
  member,
  lead = false,
  testId,
  onOpen,
}: {
  member: TeamMember;
  lead?: boolean;
  testId: string;
  onOpen: () => void;
}) {
  const { bot } = member;
  const state = stateOf(member);
  const failed = bot.status === "failed";
  return (
    <Button
      variant="ghost"
      data-testid={testId}
      data-state={member.needsYou ? "needs-you" : member.working ? "working" : "idle"}
      className={`h-auto w-full justify-start gap-3 rounded-xl px-3 text-start transition-transform duration-150 active:scale-[0.99] motion-reduce:transition-none ${
        lead ? "py-3" : "py-2"
      }`}
      onClick={onOpen}
    >
      <BotAvatar color={bot.color} identity={bot.id} size={lead ? 36 : 28} status={bot.status} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-[14px] font-medium text-foreground" dir="auto">
          {bot.name}
        </span>
        {bot.title ? (
          <span
            dir="auto"
            className="min-w-0 truncate text-[13px] font-normal text-muted-foreground"
          >
            {bot.title}
          </span>
        ) : null}
      </span>
      {state.text ? (
        <span
          className={`flex shrink-0 items-center gap-1.5 text-xs font-normal ${
            state.tone === "working"
              ? "text-shimmer"
              : state.tone === "attention"
                ? failed
                  ? "text-destructive"
                  : "text-brand"
                : "text-muted-foreground"
          }`}
        >
          {state.tone === "attention" && !failed ? (
            <span aria-hidden="true" className="size-1.5 rounded-full bg-brand" />
          ) : null}
          {state.text}
        </span>
      ) : null}
    </Button>
  );
}

/** The tickets an agent has open, each one opening on the board. Nothing for an agent with none. */
function MemberTickets({
  tickets,
  botId,
  onOpen,
}: {
  tickets: readonly Ticket[] | undefined;
  botId: string;
  onOpen: (path: string) => void;
}) {
  if (!tickets?.length) return null;
  return (
    <ul data-testid={`member-tickets-${botId}`} className="ms-14 flex flex-col pb-1">
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 rounded-lg px-2 py-1 text-start text-xs font-normal text-muted-foreground"
            onClick={() => onOpen(`/app/board?ticket=${ticket.ref}`)}
          >
            <span className="shrink-0 font-mono text-[11px] tabular-nums">{ticket.ref}</span>
            <span className="truncate" dir="auto">
              {ticket.title}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
