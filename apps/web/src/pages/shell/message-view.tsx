import {
  ChatMarkdown,
  LinkifiedText,
  withBlockAtMentions,
  withBlockMentions,
} from "@corvo/chat-ui/web";
import type { MessageReaction, ThreadMessage } from "@corvo/contracts";
import type { ChildBotBlock } from "@corvo/core";
import {
  ACTIVE_RUN_STATUSES,
  isPeerReceiptBlocks,
  isSecretAskBlock,
  isToolActivityBlock,
  proposalSteps,
} from "@corvo/core";
import { BotAvatar, Button, cn, resolvePersonaColorDef } from "@corvo/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, memo, useMemo } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import { AskCard } from "../../components/AskCard";
import { CollaborationMarker } from "../../components/ai/CollaborationMarker";
import { CloudAgentCard } from "../../components/CloudAgentCard";
import { MemoryFactBlock } from "../../components/MemoryFactBlock";
import { PlanCard } from "../../components/PlanCard";
import { SubagentCard } from "../../components/SubagentCard";
import {
  LIVE_TOOL_STEP_WINDOW,
  StandaloneToolActivity,
  ToolActivityDisclosure,
  ToolOnlyNarration,
  ToolSteps,
} from "../../components/ToolActivityDisclosure";
import { SkillDraftCard } from "../../components/teach/SkillDraftCard";
import { WikiChangeBlock } from "../../components/WikiChangeBlock";
import { approvalTextLabel } from "../../lib/activity-label";
import type { ArtifactTarget } from "../../lib/artifact-open";
import { useComposerTyping } from "../../lib/composer-typing";
import type { DelegationState } from "../../lib/delegation-states";
import { delegationKey } from "../../lib/delegation-states";
import { messageProviderLabel } from "../../lib/messaging";
import {
  isToolOnlyNarration,
  renderableMessageBlocks,
  shouldRenderToolCard,
  toolStepCount,
} from "../../lib/tool-activity-view";
import { ReplyLine } from "./chat-context";
import { FALLBACK_BOT_COLOR, previewMessageText } from "./chat-shared";
import type { ImportSetupTarget } from "./import-setup-card";
import { ImportSetupCard } from "./import-setup-card";
import {
  AppConnectCard,
  ArtifactImage,
  ChartBlockView,
  ChoiceCard,
  McpApprovalCard,
} from "./message-cards";
import { MessageHoverActions } from "./message-hover-actions";

/**
 * How an agent's face in the conversation is drawn: a still picture, moving, or moving and showing
 * that the agent is at work (its latest message).
 */
export type MessageFace = "still" | "live" | "current";

/** Looking at the composer below, while the person types. */
const TOWARD_COMPOSER = { x: 0, y: 0.9 };
/** Looking along the line to the agent a handoff names, beside the sender's name. */
const TOWARD_RECIPIENT = { x: 0.9, y: -0.15 };

/**
 * An agent's face in the conversation. It is live while it is among the latest messages, looks at
 * the composer while the person types, and otherwise at `toward`, when it hands work to someone.
 */
function ChannelFace({
  color,
  identity,
  face,
  status,
  toward,
}: {
  color: string;
  identity?: string;
  face: MessageFace;
  status?: string;
  toward?: { x: number; y: number };
}) {
  const typing = useComposerTyping();
  return (
    <BotAvatar
      color={color}
      identity={identity}
      size={36}
      live={face !== "still"}
      // Only an agent's latest message shows what it is doing; its older ones keep a calm face.
      status={face === "current" ? status : undefined}
      lookAt={face !== "still" ? (typing ? TOWARD_COMPOSER : toward) : undefined}
    />
  );
}

export const MessageView = memo(function MessageView({
  artifactTarget,
  canAnswer,
  canDismiss,
  message,
  mentions,
  onAnswer,
  onOpenBot,
  onOpenPeerMessages,
  peerReplies,
  onTogglePeerReplies,
  speakerName,
  speakerRole,
  channelMembers,
  continued = false,
  face = "still",
  memberName,
  peerBot,
  delegation,
  replyParent,
  onJumpToMessage,
  onRefresh,
  onBotChanged,
  onAddRoutine,
  voiceReady,
  speaking,
  onSpeak,
  onOpenComputer,
  onOpenImportSetup,
  onOpenImport,
  showToolActivity,
  onReply,
  onReplyInThread,
  onMarkUnread,
  onKeepInWiki,
  markedUnread = false,
  onReact,
}: {
  artifactTarget: ArtifactTarget;
  canAnswer: boolean;
  canDismiss: boolean;
  message: ThreadMessage;
  /** Bots this reply announces, named inline in its text. */
  mentions?: readonly ChildBotBlock[];
  onAnswer: (
    message: ThreadMessage,
    text: string,
    username?: string,
    dismiss?: boolean,
    approvalEffectId?: string,
  ) => Promise<void>;
  onOpenBot: (botId: string) => void;
  onOpenPeerMessages: (peer: { peerBotId: string; peerBotName: string }) => void;
  /** Set on a received marker whose peer run has folded replies. */
  peerReplies?: "collapsed" | "expanded";
  onTogglePeerReplies: (markerId: string) => void;
  speakerName?: string;
  /** The agent's role, muted beside its name. */
  speakerRole?: string;
  /** The agents of a channel: an `@Name` of theirs in a message is shown as a chip. */
  channelMembers?: readonly { id: string; name: string }[];
  /** The same agent as the message above, a moment later: no name or face of its own. */
  continued?: boolean;
  /** Only the latest messages have a moving face, so a long history stays still. */
  face?: MessageFace;
  memberName?: (botId: string | undefined) => string | undefined;
  peerBot: (botId: string) => { name?: string; color: string; status?: string } | undefined;
  /** Whether each request this bot sent to another bot has been answered. */
  delegation?: ReadonlyMap<string, DelegationState>;
  replyParent?: ThreadMessage;
  onJumpToMessage?: (messageId: string) => void;
  onRefresh: () => Promise<void>;
  onBotChanged: () => Promise<void>;
  onAddRoutine: (name: string, prompt: string) => void;
  voiceReady: boolean;
  speaking: boolean;
  onSpeak: () => void;
  onOpenComputer: (botId?: string) => void;
  /** Opens where an imported item's setup is finished. */
  onOpenImportSetup?: (target: ImportSetupTarget) => void;
  /** Opens the agent importer (from Chief's first-run focus card). */
  onOpenImport?: () => void;
  showToolActivity: boolean;
  /** Quotes this message in the composer; absent where there is none. */
  onReply?: (message: ThreadMessage) => void;
  /** Opens this message's thread; offered only in a channel's main column. */
  onReplyInThread?: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  /** Asks the wiki to keep this message; absent where there is no conversation to keep from. */
  onKeepInWiki?: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
}) {
  const { t, i18n } = useLingui();
  // Where work handed to another bot stands: answered, being worked on right now, or waiting.
  const delegationMarker = (state: DelegationState | undefined, peerStatus: string | undefined) => {
    if (!state) return undefined;
    if (state === "answered") return { kind: "answered" as const, label: t`answered` };
    return ACTIVE_RUN_STATUSES.some((status) => status === peerStatus)
      ? { kind: "working" as const, label: t`working` }
      : { kind: "waiting" as const, label: t`waiting` };
  };
  const isNarration =
    message.role === "bot" &&
    message.blocks.length > 0 &&
    message.blocks.every(
      (block) => block.kind === "text" || block.kind === "progress" || block.kind === "steps",
    );
  const isLive = message.id.startsWith("progress:");
  const quoteMessageId = message.id.includes(":") ? undefined : message.id;

  // Only what is drawn names the mentioned bots; copy, quote, and speech keep the original text.
  const blocks = useMemo(() => {
    const named = mentions?.length
      ? withBlockMentions(
          message.blocks,
          mentions.map((bot) => ({ id: bot.botId, name: bot.name })),
        )
      : message.blocks;
    return message.role === "bot" && channelMembers?.length
      ? withBlockAtMentions(named, channelMembers)
      : named;
  }, [message.blocks, message.role, mentions, channelMembers]);
  const visibleNarrationBlocks = renderableMessageBlocks(blocks, showToolActivity);
  // Several proposals from one reply are decided one at a time.
  const steps = proposalSteps(blocks);
  const { position, total } = steps;
  const renderMention = (id: string) => {
    const block =
      mentions?.find((bot) => bot.botId === id) ??
      channelMembers
        ?.filter((member) => member.id === id)
        .map((member) => ({ botId: member.id, name: member.name, status: "created" as const }))[0];
    return block ? (
      <BotMention block={block} color={peerBot(id)?.color} onOpenBot={onOpenBot} />
    ) : undefined;
  };
  const replyBotId = message.replyPreview?.botId ?? replyParent?.botId;
  const speakerBot = message.botId ? peerBot?.(message.botId) : undefined;
  // In a channel an agent's message has its face to the left, with the name and time above it.
  const speakerAvatar = speakerName ? (
    continued ? (
      // A follow-up keeps the column, and shows its time in it when pointed at.
      <time
        dateTime={message.createdAt}
        className="flex h-6 w-9 items-center justify-center text-[11px] tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 motion-reduce:transition-none"
      >
        {new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", {
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    ) : message.role === "user" ? (
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <UserRound className="size-[18px]" />
      </span>
    ) : (
      <ChannelFace
        color={speakerBot?.color ?? FALLBACK_BOT_COLOR}
        identity={message.botId}
        face={face}
        status={speakerBot?.status}
        toward={
          channelMembers && message.blocks.some((block) => block.kind === "handoff")
            ? TOWARD_RECIPIENT
            : undefined
        }
      />
    )
  ) : null;
  const botBubble = speakerName
    ? "max-w-full text-body1 text-foreground"
    : "max-w-full rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground";
  const messageContext = (
    <>
      {speakerName && !continued ? (
        <div className="mb-1 flex items-baseline gap-2" dir="auto">
          <span className="text-[15px] font-semibold text-foreground">{speakerName}</span>
          {speakerRole ? (
            <span dir="auto" className="min-w-0 truncate text-[12.5px] text-muted-foreground">
              {speakerRole}
            </span>
          ) : null}
          <time
            dateTime={message.createdAt}
            className="text-[12px] tabular-nums text-muted-foreground"
          >
            {new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </div>
      ) : null}
      <ReplyLine
        target={artifactTarget}
        message={message}
        fallbackText={replyParent ? previewMessageText(replyParent) : undefined}
        author={
          (message.replyPreview?.role ?? replyParent?.role) === "user"
            ? t`You`
            : ((replyBotId ? peerBot(replyBotId)?.name : undefined) ??
              memberName?.(replyBotId) ??
              t`Bot`)
        }
        onJump={onJumpToMessage}
      />
    </>
  );
  // Anchored below the speaker and reply line so the rail centers on the bubble itself.
  // A message with text and attachments anchors it on its first text bubble.
  const textAnchorIndex = message.blocks.findIndex((block) => block.kind === "text");
  const hoverAnchorIndex =
    textAnchorIndex === -1
      ? message.blocks.findIndex((block) => block.kind === "ask")
      : textAnchorIndex;
  const hoverActions = isPeerReceiptBlocks(message.blocks) ? null : (
    <MessageHoverActions
      message={message}
      side={message.role === "user" && !speakerName ? "start" : "end"}
      onReply={onReply}
      onReplyInThread={onReplyInThread}
      onMarkUnread={onMarkUnread}
      onKeepInWiki={onKeepInWiki}
      markedUnread={markedUnread}
      onReact={onReact}
    />
  );
  if (isNarration) {
    if (visibleNarrationBlocks.length === 0) return null;
    if (isToolOnlyNarration(message.blocks, showToolActivity)) {
      return (
        <ChannelRow avatar={speakerAvatar}>
          {messageContext}
          <div className="relative">
            <ToolOnlyNarration blocks={visibleNarrationBlocks} live={isLive} />
            {hoverActions}
          </div>
        </ChannelRow>
      );
    }
    return (
      <ChannelRow avatar={speakerAvatar}>
        {messageContext}
        <div className="relative w-fit max-w-full [@media(hover:none)]:w-full">
          <div className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full">
            <div
              data-testid="message-bot-bubble"
              className={cn("space-y-2.5", botBubble)}
              dir="auto"
            >
              {visibleNarrationBlocks.map((block, i) => {
                if (block.kind === "steps") {
                  return (
                    <ToolActivityDisclosure
                      key={i}
                      live={isLive}
                      stepCount={toolStepCount(block.steps)}
                      durationMs={block.durationMs}
                    >
                      <ToolSteps
                        steps={block.steps}
                        currentIndex={isLive ? block.steps.length - 1 : undefined}
                        limit={isLive ? LIVE_TOOL_STEP_WINDOW : undefined}
                      />
                    </ToolActivityDisclosure>
                  );
                }
                if (block.kind === "text" || block.kind === "progress") {
                  return (
                    <div
                      key={i}
                      data-quote-message-id={block.kind === "text" ? quoteMessageId : undefined}
                    >
                      <ChatMarkdown
                        streaming={block.kind === "progress"}
                        renderMention={renderMention}
                      >
                        {block.text}
                      </ChatMarkdown>
                    </div>
                  );
                }
                return null;
              })}
              {!isLive && voiceReady && message.blocks.some((block) => block.kind === "text") ? (
                <Button
                  variant="text"
                  size="xs"
                  aria-label={speaking ? t`Stop speaking` : t`Speak this reply`}
                  onClick={onSpeak}
                  className="font-normal"
                >
                  {speaking ? <Trans>Stop</Trans> : <Trans>Speak</Trans>}
                </Button>
              ) : null}
            </div>
          </div>
          {hoverActions}
        </div>
      </ChannelRow>
    );
  }
  return (
    <ChannelRow avatar={speakerAvatar}>
      {messageContext}
      <div
        className={cn(
          "relative flex flex-col gap-2",
          message.role === "user" && !speakerName && "items-end",
        )}
      >
        {blocks.map((block, i) => {
          if (block.kind === "steps" && shouldRenderToolCard(block, showToolActivity)) {
            return (
              <StandaloneToolActivity
                key={i}
                live={isLive}
                steps={block.steps}
                stepCount={toolStepCount(block.steps)}
                durationMs={block.durationMs}
              />
            );
          }
          if (isToolActivityBlock(block)) return null;
          if (block.kind === "handoff") {
            // A routed handoff can come from a bot outside the group, so fall back to the bot list.
            const from = memberName?.(block.fromBotId) ?? peerBot(block.fromBotId)?.name ?? t`bot`;
            const to = memberName?.(block.toBotId) ?? peerBot(block.toBotId)?.name ?? t`bot`;
            if (channelMembers) {
              // In a channel a handoff reads as a message from the sender, addressed to the agent.
              return (
                <div key={i} data-testid="channel-handoff" className="flex gap-3">
                  {speakerName ? null : (
                    <span className="mt-0.5 shrink-0">
                      <ChannelFace
                        color={peerBot(block.fromBotId)?.color ?? FALLBACK_BOT_COLOR}
                        identity={block.fromBotId}
                        face={face}
                        status={peerBot(block.fromBotId)?.status}
                        toward={TOWARD_RECIPIENT}
                      />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-baseline gap-x-2" dir="auto">
                      {speakerName ? null : (
                        <span className="text-[15px] font-semibold text-foreground">{from}</span>
                      )}
                      <span className="flex items-baseline gap-1.5 text-[14px]">
                        <span aria-hidden="true" className="text-muted-foreground">
                          →
                        </span>
                        <BotMention
                          block={{ botId: block.toBotId, name: to, status: "created" }}
                          color={peerBot(block.toBotId)?.color}
                          onOpenBot={onOpenBot}
                        />
                      </span>
                      {speakerName ? null : (
                        <time
                          dateTime={message.createdAt}
                          className="text-[12px] tabular-nums text-muted-foreground"
                        >
                          {new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      )}
                    </div>
                    <div className="text-body1 text-foreground" dir="auto">
                      <ChatMarkdown renderMention={renderMention}>{block.text}</ChatMarkdown>
                    </div>
                    {block.reason ? (
                      <p
                        data-testid="handoff-reason"
                        dir="auto"
                        className="mt-1 text-[13px] text-muted-foreground"
                      >
                        {block.reason}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            }
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 py-1 text-[13.5px] text-muted-foreground",
                  speakerName ? "flex-wrap justify-start" : "justify-center",
                )}
              >
                {channelMembers ? (
                  <span className="flex shrink-0 items-center" aria-hidden="true">
                    <BotAvatar
                      color={peerBot(block.fromBotId)?.color ?? FALLBACK_BOT_COLOR}
                      identity={block.fromBotId}
                      size={16}
                    />
                    <BotAvatar
                      color={peerBot(block.toBotId)?.color ?? FALLBACK_BOT_COLOR}
                      identity={block.toBotId}
                      size={16}
                      className="-ms-1"
                    />
                  </span>
                ) : null}
                <span>
                  ↪ {to} ← {from}
                </span>
                <span>{block.text}</span>
                {block.reason ? (
                  <span data-testid="handoff-reason" className="italic">
                    {block.reason}
                  </span>
                ) : null}
              </div>
            );
          }
          if (block.kind === "bot_message_sent" || block.kind === "bot_message_received") {
            const sent = block.kind === "bot_message_sent";
            const peer = sent ? block.toBotName : block.fromBotName;
            const peerBotId = sent ? block.toBotId : block.fromBotId;
            const label = sent ? t`Messaged ${peer}` : t`Message from ${peer}`;
            const toggleLabel =
              peerReplies === "expanded" ? t`Collapse ${label}` : t`Expand ${label}`;
            return (
              <Fragment key={i}>
                <CollaborationMarker
                  ariaLabel={label}
                  color={peerBot(peerBotId)?.color ?? FALLBACK_BOT_COLOR}
                  identity={peerBotId}
                  label={label}
                  onClick={() => onOpenPeerMessages({ peerBotId, peerBotName: peer })}
                  state={delegationMarker(
                    sent ? delegation?.get(delegationKey(message.id, i)) : undefined,
                    peerBot(peerBotId)?.status,
                  )}
                  replies={
                    !sent && peerReplies
                      ? {
                          expanded: peerReplies === "expanded",
                          label: toggleLabel,
                          onToggle: () => onTogglePeerReplies(message.id),
                        }
                      : undefined
                  }
                />
              </Fragment>
            );
          }
          if (block.kind === "channel_message") {
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span className="shrink-0">
                  {messageProviderLabel(block.provider, block.transport)}
                </span>
                <span>
                  {block.fromLabel}: {block.text}
                </span>
              </div>
            );
          }
          if (block.kind === "meta") {
            return (
              <div
                key={i}
                className="flex items-center justify-center gap-2 py-1 text-[13.5px] text-muted-foreground"
              >
                <span className="text-warning">◷</span>
                <span>{block.text}</span>
              </div>
            );
          }
          if (block.kind === "progress") {
            return (
              <div
                key={i}
                className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full"
              >
                <div data-testid="message-bot-bubble" className={botBubble} dir="auto">
                  <ChatMarkdown streaming renderMention={renderMention}>
                    {block.text}
                  </ChatMarkdown>
                </div>
              </div>
            );
          }
          if (block.kind === "subagent") {
            return <SubagentCard key={i} block={block} />;
          }
          if (block.kind === "wiki_change") {
            return (
              <div key={i} className="flex justify-start">
                <WikiChangeBlock changeId={block.changeId} />
              </div>
            );
          }
          if (block.kind === "memory_fact") {
            return (
              <div key={i} className="flex justify-start">
                <MemoryFactBlock memoryId={block.memoryId} />
              </div>
            );
          }
          if (block.kind === "child_bot") {
            return (
              <div key={i} className="flex items-center gap-1.5 text-[15.5px]">
                <BotMention
                  block={block}
                  color={peerBot(block.botId)?.color}
                  onOpenBot={onOpenBot}
                />
                {block.status === "created" ? null : (
                  <span className="text-muted-foreground">
                    {block.status === "archived" ? <Trans>archived</Trans> : <Trans>deleted</Trans>}
                  </span>
                )}
              </div>
            );
          }
          if (block.kind === "choice") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <ChoiceCard
                key={i}
                botId={botId}
                block={block}
                onBotChanged={onBotChanged}
                onImportAgent={onOpenImport}
              />
            );
          }
          if (block.kind === "app_connect") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <AppConnectCard
                  botId={botId}
                  threadId={message.threadId}
                  messageId={message.id}
                  block={block}
                />
              </div>
            );
          }
          if (block.kind === "chart") {
            return (
              <div key={i} className="flex justify-start">
                <ChartBlockView name={block.name} spec={block.spec} data={block.data} />
              </div>
            );
          }
          if (block.kind === "import_setup") {
            return (
              <div key={i} className="flex justify-start">
                <ImportSetupCard
                  botId={"botId" in artifactTarget ? artifactTarget.botId : message.botId}
                  block={block}
                  onOpen={onOpenImportSetup}
                />
              </div>
            );
          }
          if (block.kind === "mcp_approval") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <McpApprovalCard botId={botId} threadId={message.threadId} block={block} />
              </div>
            );
          }
          if (block.kind === "image") {
            return (
              <div
                key={i}
                className={`flex ${message.role === "user" && !speakerName ? "justify-end" : "justify-start"}`}
              >
                <ArtifactImage
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                />
              </div>
            );
          }
          if (block.kind === "file") {
            return (
              <div
                key={i}
                className={`flex ${message.role === "user" && !speakerName ? "justify-end" : "justify-start"}`}
              >
                <ArtifactFileCard
                  target={artifactTarget}
                  artifactId={block.artifactId}
                  name={block.name}
                  mimeType={block.mimeType}
                  size={block.size}
                />
              </div>
            );
          }
          if (block.kind === "text" && message.role === "user" && speakerName) {
            // In a channel a person sits in the same column as the agents, with no bubble.
            return (
              <div key={i} className="relative flex w-fit max-w-full justify-start">
                <div
                  data-testid="message-user-bubble"
                  data-quote-message-id={quoteMessageId}
                  className="max-w-full whitespace-pre-wrap wrap-anywhere text-body1 text-foreground"
                  dir="auto"
                >
                  <LinkifiedText>{block.text}</LinkifiedText>
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "text" && message.role === "user") {
            // User bubbles stay literal text on web and mobile. Only explicit URLs
            // and email addresses are links, so a sent address is tappable without
            // formatting bold or headings.
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full justify-end [@media(hover:none)]:w-full [@media(hover:none)]:flex-wrap"
              >
                <div
                  data-testid="message-user-bubble"
                  data-quote-message-id={quoteMessageId}
                  className="max-w-full whitespace-pre-wrap wrap-anywhere rounded-[20px] bg-chat-user px-[18px] py-3 text-body1 text-chat-user-foreground"
                  dir="auto"
                >
                  <LinkifiedText>{block.text}</LinkifiedText>
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "text") {
            return (
              <div
                key={i}
                className="relative flex w-fit max-w-full justify-start [@media(hover:none)]:w-full [@media(hover:none)]:flex-wrap"
              >
                <div data-testid="message-bot-bubble" className={botBubble} dir="auto">
                  <div data-quote-message-id={quoteMessageId}>
                    <ChatMarkdown renderMention={renderMention}>
                      {approvalTextLabel(block.text)}
                    </ChatMarkdown>
                  </div>
                  {voiceReady ? (
                    <Button
                      variant="text"
                      size="xs"
                      aria-label={speaking ? t`Stop speaking` : t`Speak this reply`}
                      onClick={onSpeak}
                      className="mt-2 font-normal"
                    >
                      {speaking ? <Trans>Stop</Trans> : <Trans>Speak</Trans>}
                    </Button>
                  ) : null}
                </div>
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "card") {
            return (
              <div key={i} className="flex justify-start">
                <div className="flex flex-col gap-2 rounded-[20px] bg-muted px-5 py-4">
                  {block.lines.map((line) => (
                    <div key={line.k} className="flex items-baseline gap-2.5 text-[15px]">
                      <span className="text-success">✓</span>
                      <span className="font-semibold text-foreground">{line.k}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{line.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          if (block.kind === "ask") {
            const stepped = steps.total > 1 && block.proposal === true;
            if (stepped && block.status !== "answered" && i !== steps.current) return null;
            return (
              <div
                key={i}
                data-coach={canAnswer && block.status !== "answered" ? "ask" : undefined}
                className={`relative w-full min-w-0 ${isSecretAskBlock(block) ? "" : "max-w-xl"}`}
              >
                {stepped && i === steps.current ? (
                  <p className="mb-1.5 text-[13px] text-muted-foreground">
                    <Trans>
                      {position} of {total}
                    </Trans>
                  </p>
                ) : null}
                <AskCard
                  block={block}
                  canAnswer={canAnswer}
                  canDismiss={canDismiss}
                  onAnswer={(text, username, approvalEffectId) =>
                    onAnswer(message, text, username, undefined, approvalEffectId)
                  }
                  onDismiss={() => onAnswer(message, "", undefined, true)}
                />
                {i === hoverAnchorIndex ? hoverActions : null}
              </div>
            );
          }
          if (block.kind === "cloud_agent") return <CloudAgentCard key={i} block={block} />;
          if (block.kind === "plan") return <PlanCard key={i} block={block} />;
          if (block.kind === "skill_draft") {
            return (
              <div key={i} className="flex justify-start">
                <SkillDraftCard block={block} onRefresh={onRefresh} onAddRoutine={onAddRoutine} />
              </div>
            );
          }
          if (block.kind === "computer") {
            return (
              <div
                key={i}
                data-testid="computer-card"
                className="w-[340px] max-w-full rounded-[18px] border border-border bg-muted px-[18px] py-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-medium text-foreground">
                    <Trans>Computer</Trans>
                  </span>
                  <span
                    className={
                      block.state === "Needs you"
                        ? "rounded-full bg-warning/15 px-[11px] py-1 text-[13px] text-warning"
                        : block.state === "Skipped"
                          ? "rounded-full bg-foreground/10 px-[11px] py-1 text-[13px] text-muted-foreground"
                          : "rounded-full bg-success/15 px-[11px] py-1 text-[13px] text-success"
                    }
                  >
                    {block.state}
                  </span>
                </div>
                <div className="my-2.5 text-[14.5px] leading-[1.5] text-foreground/75">
                  <ChatMarkdown>{block.text}</ChatMarkdown>
                </div>
                <Button
                  type="button"
                  size="sm"
                  data-testid="computer-card-open"
                  onClick={() => onOpenComputer(message.botId)}
                >
                  <Trans>Open</Trans>
                </Button>
              </div>
            );
          }
          return null;
        })}
        {hoverAnchorIndex === -1 ? hoverActions : null}
      </div>
    </ChannelRow>
  );
});

/** A channel message: the agent's face in a column of its own, the message beside it. Others are as they are. */
function ChannelRow({ avatar, children }: { avatar: ReactNode; children: ReactNode }) {
  if (!avatar) return <>{children}</>;
  return (
    <div className="-mx-2 flex gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-muted/50 motion-reduce:transition-none">
      <span className="mt-0.5 shrink-0">{avatar}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A bot named inline in its color. A deleted, archived, or missing bot keeps only its name. */
function BotMention({
  block,
  color,
  onOpenBot,
}: {
  block: Pick<ChildBotBlock, "botId" | "name" | "status">;
  color: string | undefined;
  onOpenBot: (botId: string) => void;
}) {
  const live = block.status === "created" && color;
  const accent = live ? resolvePersonaColorDef(block.botId, color).light : undefined;
  const name = (
    <span dir="auto" className="font-medium" style={accent ? { color: accent } : undefined}>
      {block.name}
    </span>
  );
  if (!live) {
    return (
      <span data-testid="bot-mention" className="inline-flex items-baseline gap-1.5">
        <UserRound className="size-4 self-center text-muted-foreground" aria-hidden="true" />
        {name}
      </span>
    );
  }
  // A chip in the bot's color, so a name in a channel reads as someone to talk to.
  return (
    <button
      type="button"
      data-testid="bot-mention"
      onClick={() => onOpenBot(block.botId)}
      style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)` }}
      className="mx-0.5 inline-flex items-baseline gap-1.5 rounded-full px-1.5 py-px align-baseline transition-[filter] hover:brightness-125 motion-reduce:transition-none"
    >
      <span className="self-center">
        <BotAvatar color={color} identity={block.botId} size={16} />
      </span>
      {name}
    </button>
  );
}
