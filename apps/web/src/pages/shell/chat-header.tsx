import type { Bot, Group, ThreadSnapshot } from "@corvo/contracts";
import type { modelChangePatch } from "@corvo/core";
import { BotAvatar, Button, GroupAvatar } from "@corvo/ui-web";
import { useLingui } from "@lingui/react/macro";
import { Columns3, Menu, Monitor, Phone } from "lucide-react";
import { IconTooltip } from "../../components/IconTooltip";
import { ChannelHeader } from "./channel-header";
import { ChatModelSwitcher } from "./chat-model-switcher";
import { ContextMeter } from "./context-meter";

/** The floating header over the transcript: navigation, the chat's name, call and computer. */
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
      />
    );
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_minmax(0,auto)_1fr] items-center gap-2 px-3 py-[13px] md:px-[22px] [&_button]:pointer-events-auto">
      <div className="flex items-center">
        <Button
          variant="floating"
          size="icon-lg"
          aria-label={t`Open navigation`}
          onClick={onOpenNavigation}
          className="app-no-drag md:hidden"
        >
          <Menu strokeWidth={1.7} className="size-[19px]" />
        </Button>
      </div>
      <Button
        variant="floating"
        data-testid="bot-settings-trigger"
        onClick={onOpenChatSettings}
        className="app-no-drag h-auto min-w-0 gap-2 py-1 ps-1 pe-3.5"
      >
        {inGroup ? (
          <GroupAvatar members={activeSnapshot?.members ?? activeGroup?.members ?? []} size={26} />
        ) : active ? (
          <BotAvatar
            color={active.color}
            identity={active.id}
            size={26}
            status={active.status}
            live
          />
        ) : null}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium text-foreground" dir="auto">
            {inGroup
              ? (activeGroup?.name ?? activeSnapshot?.groupName ?? t`Group`)
              : (active?.name ?? t`Select a bot`)}
          </span>
        </span>
      </Button>
      <div className="flex items-center justify-self-end gap-2">
        {inGroup ? (
          <IconTooltip label={t`Squad`}>
            <Button
              variant="floating"
              size="icon-lg"
              aria-label={t`Squad`}
              onClick={onOpenSquad}
              className="app-no-drag"
            >
              <Columns3 strokeWidth={1.6} className="size-[18px]" />
            </Button>
          </IconTooltip>
        ) : null}
        {!inGroup && active ? <ContextMeter botId={active.id} running={running} /> : null}
        {!inGroup && active ? (
          <ChatModelSwitcher bot={active} onChange={(patch) => onChangeModel(active, patch)} />
        ) : null}
        {phoneCallsEnabled && !inGroup && active ? (
          <IconTooltip label={inCall ? t`Open call` : t`Call`}>
            <Button
              variant="floating"
              size="icon-lg"
              data-testid="call-button"
              aria-label={inCall ? t`Open call` : t`Call`}
              onClick={() => onCall(active)}
              data-active={inCall ? "" : undefined}
              className="app-no-drag"
            >
              <Phone strokeWidth={1.6} className="size-[17px]" />
            </Button>
          </IconTooltip>
        ) : null}
        {!inGroup && active ? (
          <IconTooltip label={t`Agent computer`}>
            <Button
              variant="floating"
              size="icon-lg"
              aria-label={t`Agent computer`}
              aria-pressed={computerPanelOpen}
              onClick={() => onToggleComputer(active)}
              className="app-no-drag"
            >
              <Monitor strokeWidth={1.6} className="size-[18px]" />
            </Button>
          </IconTooltip>
        ) : null}
      </div>
    </div>
  );
}
