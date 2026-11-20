import type { Bot, Group } from "@corvo/contracts";
import {
  Badge,
  BotAvatar,
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Kbd,
} from "@corvo/ui-web";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  CalendarClock,
  FileText,
  Gauge,
  Hash,
  ListChecks,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PersonAvatar } from "../../components/PersonAvatar";
import { useDirectPeople } from "../../lib/use-direct-people";

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  // platform is deprecated but still the most reliable Apple check in browsers.
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function botSearchText(bot: Bot) {
  return `${bot.name} ${bot.title} ${bot.description} ${bot.preview}`.toLowerCase();
}

function botSubtitle(bot: Bot) {
  return bot.description.trim() || bot.preview.trim() || bot.title.trim();
}

function botTitleTag(bot: Bot) {
  const title = bot.title.trim();
  if (!title) return null;
  // Title is already the subtitle when there is no description/preview.
  if (!(bot.description.trim() || bot.preview.trim())) return null;
  return title;
}

const PAGES: Array<{ to: string; label: () => string; icon: LucideIcon }> = [
  { to: "/app/approvals", label: () => t`Approvals`, icon: ShieldCheck },
  { to: "/app/board", label: () => t`Tasks`, icon: ListChecks },
  { to: "/app/routines", label: () => t`Routines`, icon: CalendarClock },
  { to: "/app/activity", label: () => t`Activity`, icon: Activity },
  { to: "/app/team", label: () => t`Team`, icon: Users },
  { to: "/app/usage", label: () => t`Usage`, icon: Gauge },
  { to: "/app/artifacts", label: () => t`Artifacts`, icon: FileText },
  { to: "/app/wiki", label: () => t`Wiki`, icon: BookOpen },
];

export function CommandPalette({
  open,
  onOpenChange,
  bots,
  groups,
  onSelectBot,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: Bot[];
  groups: Pick<Group, "id" | "name">[];
  onSelectBot: (botId: string) => void;
  /** Opens a path: a channel, a person's conversation or a page. */
  onNavigate: (path: string) => void;
}) {
  const people = useDirectPeople().data ?? [];
  const [search, setSearch] = useState("");
  const [modKey, setModKey] = useState("⌘");

  useEffect(() => {
    setModKey(isApplePlatform() ? "⌘" : "Ctrl");
  }, []);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const filteredBots = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return bots;
    return bots.filter((bot) => botSearchText(bot).includes(needle));
  }, [bots, search]);

  const needle = search.trim().toLowerCase();
  const filteredGroups = needle
    ? groups.filter((group) => group.name.toLowerCase().includes(needle))
    : groups;
  const filteredPeople = needle
    ? people.filter((person) => person.name.toLowerCase().includes(needle))
    : people;
  const filteredPages = needle
    ? PAGES.filter((page) => page.label().toLowerCase().includes(needle))
    : PAGES;
  const empty =
    filteredBots.length + filteredGroups.length + filteredPeople.length + filteredPages.length ===
    0;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.repeat) {
        return;
      }
      if (!/^[1-9]$/.test(event.key)) return;
      const bot = filteredBots[Number(event.key) - 1];
      if (!bot) return;
      event.preventDefault();
      onSelectBot(bot.id);
      onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredBots, onOpenChange, onSelectBot, open]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t`Go to…`}
      description={t`Search channels, agents, people and pages`}
      className="sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        className="rounded-xl! bg-popover"
        data-testid="command-palette"
      >
        <CommandInput
          value={search}
          onValueChange={setSearch}
          placeholder={t`Search`}
          data-testid="command-palette-search"
        />
        <CommandList className="max-h-80" data-testid="command-palette-list">
          {empty ? (
            <CommandEmpty>
              <Trans>No results</Trans>
            </CommandEmpty>
          ) : null}
          {filteredBots.length > 0 ? (
            <CommandGroup heading={t`Agents`}>
              {filteredBots.map((bot, index) => {
                const subtitle = botSubtitle(bot);
                const titleTag = botTitleTag(bot);
                const shortcut = index < 9 ? `${modKey}${index + 1}` : null;
                return (
                  <CommandItem
                    key={bot.id}
                    value={bot.id}
                    data-testid={`command-palette-bot-${bot.id}`}
                    onSelect={() => {
                      onSelectBot(bot.id);
                      onOpenChange(false);
                    }}
                    className="items-center gap-3 rounded-xl! px-2.5 py-2.5"
                  >
                    <BotAvatar color={bot.color} identity={bot.id} size={32} status={bot.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-foreground" dir="auto">
                          {bot.name}
                        </span>
                        {titleTag ? (
                          <Badge
                            variant="secondary"
                            className="max-w-[40%] truncate rounded-full px-1.5 py-0 text-[11px] font-normal text-muted-foreground"
                          >
                            {titleTag}
                          </Badge>
                        ) : null}
                      </div>
                      {subtitle ? (
                        <div
                          className="mt-0.5 truncate text-[13px] text-muted-foreground"
                          dir="auto"
                        >
                          {subtitle}
                        </div>
                      ) : null}
                    </div>
                    {shortcut ? (
                      <CommandShortcut className="tracking-normal">
                        <Kbd>{shortcut}</Kbd>
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {filteredGroups.length > 0 ? (
            <CommandGroup heading={t`Channels`}>
              {filteredGroups.map((group) => (
                <CommandItem
                  key={group.id}
                  value={`channel-${group.id}`}
                  data-testid={`command-palette-channel-${group.id}`}
                  onSelect={() => {
                    onNavigate(`/app/g/${group.id}`);
                    onOpenChange(false);
                  }}
                  className="gap-3 rounded-xl! px-2.5 py-2"
                >
                  <Hash className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate" dir="auto">
                    {group.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {filteredPeople.length > 0 ? (
            <CommandGroup heading={t`People`}>
              {filteredPeople.map((person) => (
                <CommandItem
                  key={person.userId}
                  value={`person-${person.userId}`}
                  data-testid={`command-palette-person-${person.userId}`}
                  onSelect={() => {
                    onNavigate(`/app/dm/${person.userId}`);
                    onOpenChange(false);
                  }}
                  className="gap-3 rounded-xl! px-2.5 py-2"
                >
                  <PersonAvatar name={person.name} image={person.image} size={20} />
                  <span className="truncate" dir="auto">
                    {person.name}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {filteredPages.length > 0 ? (
            <CommandGroup heading={t`Pages`}>
              {filteredPages.map(({ to, label, icon: Icon }) => (
                <CommandItem
                  key={to}
                  value={`page-${to}`}
                  data-testid={`command-palette-page-${to.split("/").pop()}`}
                  onSelect={() => {
                    onNavigate(to);
                    onOpenChange(false);
                  }}
                  className="gap-3 rounded-xl! px-2.5 py-2"
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{label()}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export { isCommandPaletteHotkey } from "./command-palette-hotkey";
