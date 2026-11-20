import type { Bot, Group, ThreadSnapshot } from "@corvo/contracts";
import type { modelChangePatch } from "@corvo/core";
import { BotAvatar, Button } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Menu, Monitor, Phone } from "lucide-react";
import { IconTooltip } from "../../components/IconTooltip";
import { ChannelFind, pinSignature } from "./channel-find";
import { ChannelHeader } from "./channel-header";
import { ChatModelSwitcher } from "./chat-model-switcher";
import { ContextMeter } from "./context-meter";

/** The solid row above the transcript: navigation, the chat's name, call and computer. */
export function ChatHeader({
  inGroup,
  active,
  activeGroup,
  activeSnapshot,
  phoneCallsEnabled,
  inCall,
  running,
  computerPanelOpen,
  onOpenNavigation,
  onOpenChatSettings,
  onCall,
  onToggleComputer,
  onChangeModel,
  onOpenSquad,
  onOpenMembers,
  membersOpen,
  peopleCount,
  onJumpToMessage,
  memberName,
}: {
  inGroup: boolean;
  active: Bot | undefined;
  activeGroup: Group | undefined;
  activeSnapshot: ThreadSnapshot | null;
  phoneCallsEnabled: boolean;
  inCall: boolean;
  running: boolean;
  computerPanelOpen: boolean;
  onOpenNavigation: () => void;
  onOpenChatSettings: () => void;
  onCall: (bot: Bot) => void;
  onToggleComputer: (bot: Bot) => void;
  onChangeModel: (bot: Bot, patch: ReturnType<typeof modelChangePatch>) => Promise<void>;
  onOpenSquad: () => void;
  onOpenMembers?: () => void;
  membersOpen?: boolean;
  peopleCount?: number;
  /** Scrolls the channel to a message found by its search or pinned. */
  onJumpToMessage: (messageId: string) => void;
  memberName: (botId: string | undefined) => string | undefined;
}) {
  const { t } = useLingui();
  if (inGroup) {
    return (
      <ChannelHeader
        name={activeGroup?.name ?? activeSnapshot?.groupName ?? t`Group`}
        purpose={activeGroup?.purpose}
        members={activeSnapshot?.members ?? activeGroup?.members ?? []}
        onOpenNavigation={onOpenNavigation}
        onOpenSettings={onOpenChatSettings}
        onOpenSquad={onOpenSquad}
        onOpenMembers={onOpenMembers}
        membersOpen={membersOpen}
        peopleCount={peopleCount}
        find={
          activeGroup ? (
            <ChannelFind
              groupId={activeGroup.id}
              channelName={activeGroup.name}
              pins={pinSignature(activeSnapshot?.messages ?? [])}
              memberName={memberName}
              onJump={onJumpToMessage}
            />
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="app-drag flex shrink-0 items-center gap-3 border-b border-border bg-background px-3 py-1.5 md:px-[22px]">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t`Open navigation`}
        onClick={onOpenNavigation}
        className="app-no-drag md:hidden"
      >
        <Menu strokeWidth={1.7} className="size-[19px]" />
      </Button>
      <button
        type="button"
        data-testid="bot-settings-trigger"
        onClick={onOpenChatSettings}
        className="app-no-drag flex min-w-0 items-center gap-2.5 rounded-md text-start outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {active ? (
          <BotAvatar
            color={active.color}
            identity={active.id}
            size={26}
            status={active.status}
            ring={false}
            live
          />
        ) : null}
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-name font-semibold text-foreground" dir="auto">
            {active?.name ?? t`Select an agent`}
          </span>
          {active?.title ? (
            <span
              dir="auto"
              className="hidden min-w-0 truncate text-meta text-muted-foreground md:block"
            >
              {active.title}
            </span>
          ) : null}
        </span>
      </button>
      <div className="app-no-drag ms-auto flex min-w-0 shrink-0 items-center gap-1 [&_button]:shrink-0">
        {active ? <ContextMeter botId={active.id} running={running} /> : null}
        {active ? (
          <ChatModelSwitcher bot={active} onChange={(patch) => onChangeModel(active, patch)} />
        ) : null}
        {phoneCallsEnabled && active ? (
          <IconTooltip label={inCall ? t`Open call` : t`Call`}>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="call-button"
              aria-label={inCall ? t`Open call` : t`Call`}
              onClick={() => onCall(active)}
              data-active={inCall ? "" : undefined}
              className="size-8 data-active:bg-accent"
            >
              <Phone strokeWidth={1.6} className="size-4" />
            </Button>
          </IconTooltip>
        ) : null}
        {active ? (
          <IconTooltip label={t`Agent computer`}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Agent computer`}
              aria-pressed={computerPanelOpen}
              onClick={() => onToggleComputer(active)}
              className="size-8 aria-pressed:bg-accent"
            >
              <Monitor strokeWidth={1.6} className="size-4" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>
    </div>
  );
}
