import type { Bot, ChannelPeople, CustomSpaceRole, Group, SpaceMember } from "@corvo/contracts";
import { personName } from "@corvo/core";
import {
  BotAvatar,
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { PersonAvatar } from "../../components/PersonAvatar";
import { groupPeopleByRole } from "../../lib/channel-people-groups";
import { usePresence } from "../../lib/presence";
import { useSpaceQueries } from "../../lib/query";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/**
 * Who sees a channel: its people grouped by role, then its agents with what each one does. A
 * private channel lists only the people added to it; an open one lists the whole space.
 */
export function ChannelMembersPanel({
  members,
  roles,
  people,
  agents,
  allAgents,
  currentUserId,
  error,
  onClose,
  onAddPeople,
  onAddAgent,
  onRemovePerson,
  onMakePrivate,
  onOpenToEveryone,
}: {
  members: readonly SpaceMember[];
  roles: readonly CustomSpaceRole[];
  people: Pick<ChannelPeople, "restricted" | "userIds" | "canManage">;
  /** The channel's agents. */
  agents: ReadonlyArray<Pick<Bot, "id" | "name" | "title" | "color">>;
  /** Every agent the picker may offer. */
  allAgents: ReadonlyArray<Pick<Bot, "id" | "name" | "title" | "color">>;
  currentUserId: string;
  error?: string | null;
  onClose: () => void;
  onAddPeople: (userIds: string[]) => void;
  onAddAgent: (botId: string) => void;
  onRemovePerson: (userId: string) => void;
  onMakePrivate: () => void;
  onOpenToEveryone: () => void;
}) {
  const { t } = useLingui();
  const presence = usePresence();
  const [pickerOpen, setPickerOpen] = useState(false);
  const groups = groupPeopleByRole({
    members,
    roles,
    visible: people.restricted ? people.userIds : null,
  });
  const inChannel = new Set(agents.map((agent) => agent.id));
  const addable = allAgents.filter((agent) => !inChannel.has(agent.id));
  const addablePeople = people.restricted
    ? members.filter((member) => !people.userIds.includes(member.userId))
    : [];
  const canPick = people.canManage;
  return (
    <section aria-label={t`Members`} data-testid="channel-members" className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <span className="text-[13.5px] text-muted-foreground">
          <Trans>Who sees this channel</Trans>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t`Close panel`} onClick={onClose}>
          <X size={16} strokeWidth={1.8} />
        </Button>
      </div>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {`${group.kind === "owner" ? t`Owner` : (group.title ?? t`Everyone`)} — ${group.members.length}`}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {group.members.map((member) => (
              <li key={member.userId} className="group/person flex items-center gap-2.5">
                <PersonAvatar
                  name={member.name}
                  size={28}
                  presence={
                    member.userId === currentUserId ? undefined : presence.get(member.userId)
                  }
                />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm">{member.name}</span>
                  {member.userId === currentUserId ? (
                    <span className="truncate text-xs text-muted-foreground">{t`you`}</span>
                  ) : null}
                </span>
                {people.canManage &&
                people.restricted &&
                member.userId !== currentUserId &&
                group.kind !== "owner" ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t`Remove ${member.name}`}
                    onClick={() => onRemovePerson(member.userId)}
                    className="opacity-0 focus-visible:opacity-100 group-hover/person:opacity-100"
                  >
                    <X size={14} strokeWidth={1.8} />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {`${t`Agents`} — ${agents.length}`}
        </h3>
        <ul className="flex flex-col gap-1.5">
          {agents.map((agent) => (
            <li key={agent.id} className="flex items-center gap-2.5">
              <BotAvatar color={agent.color} identity={agent.id} size={28} />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm">{agent.name}</span>
                {agent.title ? (
                  <span className="truncate text-xs text-muted-foreground">{agent.title}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {canPick ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className="h-auto self-start rounded-[10px] border-dashed px-3.5 py-2 text-[13px] font-medium"
              />
            }
          >
            <span aria-hidden="true">+</span>
            <Trans>Add people or agents</Trans>
          </PopoverTrigger>
          {pickerOpen ? (
            <PopoverContent align="start" className="w-[min(300px,calc(100vw-2rem))] gap-0 p-0">
              <Command className="h-auto rounded-none border-0 bg-transparent p-0">
                <label className="flex items-center border-b border-border px-3 py-2">
                  <input
                    placeholder={t`Search`}
                    aria-label={t`Search`}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </label>
                <CommandList className="max-h-72 p-1">
                  <CommandEmpty>
                    <Trans>No matches</Trans>
                  </CommandEmpty>
                  {addablePeople.length ? (
                    <CommandGroup heading={t`People`}>
                      {addablePeople.map((member) => (
                        <CommandItem
                          key={member.userId}
                          value={`person ${member.name}`}
                          onSelect={() => {
                            setPickerOpen(false);
                            onAddPeople([member.userId]);
                          }}
                          className="gap-2"
                        >
                          <PersonAvatar name={member.name} size={20} />
                          {member.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                  {addable.length ? (
                    <CommandGroup heading={t`Agents`}>
                      {addable.map((agent) => (
                        <CommandItem
                          key={agent.id}
                          value={`agent ${agent.name} ${agent.title}`}
                          onSelect={() => {
                            setPickerOpen(false);
                            onAddAgent(agent.id);
                          }}
                          className="gap-2"
                        >
                          <BotAvatar color={agent.color} identity={agent.id} size={20} />
                          {agent.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ) : null}
                  <CommandSeparator />
                  <CommandGroup forceMount>
                    <CommandItem
                      value="visibility"
                      forceMount
                      onSelect={() => {
                        setPickerOpen(false);
                        if (people.restricted) onOpenToEveryone();
                        else onMakePrivate();
                      }}
                    >
                      {people.restricted ? t`Open to everyone` : t`Make private`}
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          ) : null}
        </Popover>
      ) : null}
    </section>
  );
}

/** The panel for the open channel, with its people and roles read from the space. */
export function ChannelMembers({
  rpc,
  group,
  bots,
  currentUserId,
  onClose,
  onAddAgent,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  group: Group;
  bots: readonly Bot[];
  currentUserId: string;
  onClose: () => void;
  onAddAgent: (botId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const membersQuery = useQuery(queries.spaces.members.list.queryOptions({ input: {} }));
  const rolesQuery = useQuery(queries.spaces.roles.list.queryOptions({ input: {} }));
  const peopleKey = queries.groups.people.list.queryOptions({ input: { groupId: group.id } });
  const peopleQuery = useQuery(peopleKey);
  if (!membersQuery.data || !rolesQuery.data || !peopleQuery.data) return null;
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const agents = group.members.map((member) => ({
    id: member.botId,
    name: member.name,
    color: member.color,
    title: botById.get(member.botId)?.title ?? "",
  }));
  async function change(run: () => Promise<unknown>) {
    setError(null);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: peopleKey.queryKey });
    } catch (cause) {
      setError(errorText(cause, t`Could not change who sees this channel`));
    }
  }
  return (
    <ChannelMembersPanel
      members={membersQuery.data.map((member) => ({
        ...member,
        name: personName(member.name, member.email),
      }))}
      roles={rolesQuery.data.roles}
      people={peopleQuery.data}
      agents={agents}
      allAgents={bots.filter((bot) => !bot.archivedAt)}
      currentUserId={currentUserId}
      error={error}
      onClose={onClose}
      onAddPeople={(userIds) =>
        void change(() => rpc.groups.people.add({ groupId: group.id, userIds }))
      }
      onAddAgent={(botId) => void change(() => onAddAgent(botId))}
      onRemovePerson={(userId) =>
        void change(() => rpc.groups.people.remove({ groupId: group.id, userId }))
      }
      onMakePrivate={() =>
        void change(() => rpc.groups.people.add({ groupId: group.id, userIds: [currentUserId] }))
      }
      onOpenToEveryone={() => void change(() => rpc.groups.people.open({ groupId: group.id }))}
    />
  );
}
