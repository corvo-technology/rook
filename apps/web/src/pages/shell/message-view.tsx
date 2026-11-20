import {
  ChatMarkdown,
  LinkifiedText,
  withBlockAtMentions,
  withBlockMentions,
} from "@corvo/chat-ui/web";
import type { MessageBlock, MessageReaction, ThreadMessage } from "@corvo/contracts";
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
import { Pin, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, memo, useMemo } from "react";
import { ArtifactFileCard } from "../../components/ArtifactFileCard";
import { AskCard } from "../../components/AskCard";
import { CollaborationMarker } from "../../components/ai/CollaborationMarker";
import { CloudAgentCard } from "../../components/CloudAgentCard";
import { MemoryFactBlock } from "../../components/MemoryFactBlock";
import { PersonAvatar } from "../../components/PersonAvatar";
import { PlanCard } from "../../components/PlanCard";
import { SubagentCard } from "../../components/SubagentCard";
import { TaskCard } from "../../components/TaskCard";
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
import { metaCopy } from "../../lib/server-copy";
import {
  isToolOnlyNarration,
  renderableMessageBlocks,
  shouldRenderToolCard,
  toolStepCount,
} from "../../lib/tool-activity-view";
import { ReplyLine } from "./chat-context";
import { FALLBACK_BOT_COLOR, previewMessageText } from "./chat-shared";
import { HostActionCard } from "./host-action-card";
import type { ImportSetupTarget } from "./import-setup-card";
import { ImportSetupCard } from "./import-setup-card";
import {
  AppConnectCard,
  ArtifactImage,
  ChartBlockView,
  ChoiceCard,
  type ImageAsk,
  McpApprovalCard,
} from "./message-cards";
import { MessageHoverActions } from "./message-hover-actions";
import { RoutingLine, showsRouting } from "./routing-line";

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
      size={32}
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
  relayedVia,
  speakerImage,
  ownerUserId,
  viewerUserId,
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
  onImageAsk,
  onReplyInThread,
  onMarkUnread,
  onKeepInWiki,
  markedUnread = false,
  onReact,
  onPin,
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
  /** The agent this chat belongs to, named on a message another agent sent through it. */
  relayedVia?: string;
  /** The picture of the person who wrote a user message in a channel. */
  speakerImage?: string | null;
  /** Who owns the agent that wrote this message, and who is reading: an approval names which. */
  ownerUserId?: string;
  viewerUserId?: string;
  /** The agents of a channel: an `@Name` of theirs in a message is shown as a chip. */
  channelMembers?: readonly { id: string; name: string }[];
  /** The same agent as the message above, a moment later: no name or face of its own. */
  continued?: boolean;
  /** Only the latest messages have a moving face, so a long history stays still. */
  face?: MessageFace;
  memberName?: (botId: string | undefined) => string | undefined;
  peerBot: (
    botId: string,
  ) => { name?: string; title?: string; color: string; status?: string } | undefined;
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
  /** Asks the agent to work from one of its pictures. */
  onImageAsk?: (message: ThreadMessage, artifactId: string, ask: ImageAsk) => void;
  /** Opens this message's thread; offered only in a channel's main column. */
  onReplyInThread?: (message: ThreadMessage) => void;
  onMarkUnread: (message: ThreadMessage) => void;
  /** Asks the wiki to keep this message; absent where there is no conversation to keep from. */
  onKeepInWiki?: (message: ThreadMessage) => void;
  markedUnread?: boolean;
  onReact: (message: ThreadMessage, reaction: MessageReaction) => Promise<void>;
  /** Pins the message to its channel, or unpins it; absent where there is no pin list. */
  onPin?: (message: ThreadMessage, pinned: boolean) => Promise<void>;
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
  const received = message.blocks.find((block) => block.kind === "bot_message_received");
  const sender = received ? peerBot(received.fromBotId) : undefined;
  const speakerAvatar = received ? (
    <ChannelFace
      color={sender?.color ?? FALLBACK_BOT_COLOR}
      identity={received.fromBotId}
      face="still"
    />
  ) : speakerName ? (
    continued ? (
      // A follow-up keeps the column, and shows its time in it when pointed at.
      <time
        dateTime={message.createdAt}
        className="flex h-5 w-9 items-center justify-center text-caption tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 motion-reduce:transition-none"
      >
        {new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", {
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    ) : message.role === "user" ? (
      <PersonAvatar name={speakerName} image={speakerImage} size={32} />
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
  const botBubble = "max-w-full text-message text-foreground";
  const time = () => (
    <time dateTime={message.createdAt} className="text-meta tabular-nums text-muted-foreground">
      {new Date(message.createdAt).toLocaleTimeString(i18n.locale || "en", {
        hour: "numeric",
        minute: "2-digit",
      })}
    </time>
  );
  const messageContext = (
    <>
      {received ? (
        // A message from another agent reads as that agent's own row, with this chat's agent behind it.
        <div className="flex items-baseline gap-2" dir="auto">
          <span className="text-name font-semibold text-foreground">{received.fromBotName}</span>
          {sender?.title ? (
            <span dir="auto" className="min-w-0 truncate text-meta text-muted-foreground">
              {sender.title}
            </span>
          ) : null}
          {time()}
          {relayedVia && relayedVia !== received.fromBotName ? (
            <span className="text-meta text-muted-foreground">{t`via ${relayedVia}`}</span>
          ) : null}
        </div>
      ) : null}
      {speakerName && !continued ? (
        <div className="flex items-baseline gap-2" dir="auto">
          <span className="text-name font-semibold text-foreground">{speakerName}</span>
          {speakerRole ? (
            <span dir="auto" className="min-w-0 truncate text-meta text-muted-foreground">
              {speakerRole}
            </span>
          ) : null}
          {message.routineName ? (
            <span
              data-testid="routine-badge"
              className="rounded-full border border-border px-2 py-px text-meta text-muted-foreground"
            >
              {t`Routine “${message.routineName}”`}
            </span>
          ) : null}
          {time()}
          {message.pinnedAt ? (
            <Pin
              role="img"
              aria-label={t`Pinned`}
              data-testid="pinned-mark"
              className="size-3 self-center text-muted-foreground"
              strokeWidth={1.8}
            />
          ) : null}
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
      onReply={onReply}
      onReplyInThread={onReplyInThread}
      onMarkUnread={onMarkUnread}
      onKeepInWiki={onKeepInWiki}
      markedUnread={markedUnread}
      onReact={onReact}
      onPin={onPin}
      speech={
        voiceReady && !isLive && message.blocks.some((block) => block.kind === "text")
          ? { speaking, onSpeak }
          : undefined
      }
    />
  );
  if (isNarration) {
    if (visibleNarrationBlocks.length === 0) return null;
    if (isToolOnlyNarration(message.blocks, showToolActivity)) {
      return (
        <ChannelRow avatar={speakerAvatar}>
          {messageContext}
          <div>
            <ToolOnlyNarration
              blocks={visibleNarrationBlocks}
              live={isLive}
              pill={Boolean(speakerName)}
            />
            {hoverActions}
          </div>
        </ChannelRow>
      );
    }
    return (
      <ChannelRow avatar={speakerAvatar}>
        {messageContext}
        <div className="w-fit max-w-full [@media(hover:none)]:w-full">
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
                      pill={Boolean(speakerName)}
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
      <div className="flex flex-col gap-2">
        {blocks.map((block, i) => {
          if (block.kind === "steps" && shouldRenderToolCard(block, showToolActivity)) {
            return (
              <StandaloneToolActivity
                key={i}
                pill={Boolean(speakerName)}
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
                        <span className="text-name font-semibold text-foreground">{from}</span>
                      )}
                      <span className="flex items-baseline gap-1.5 text-message">
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
                          className="text-meta tabular-nums text-muted-foreground"
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
                        className="mt-1 text-body2 text-muted-foreground"
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
                  "flex items-center gap-2 py-1 text-body2 text-muted-foreground",
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
                className="flex items-center justify-center gap-2 py-1 text-body2 text-muted-foreground"
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
                className="flex items-center justify-center gap-2 py-1 text-body2 text-muted-foreground"
              >
                <span className="text-warning">◷</span>
                <span title={block.detail}>
                  {(block.code && metaCopy(block.code, block.params ?? {})) || block.text}
                </span>
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
          if (block.kind === "ticket") {
            return <TaskCard key={i} taskRef={block.ref} title={block.title} />;
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
              <div key={i} className="flex items-center gap-1.5 text-name">
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
          if (block.kind === "host_action") {
            const botId = "botId" in artifactTarget ? artifactTarget.botId : message.botId;
            if (!botId) return null;
            return (
              <div key={i} className="flex justify-start">
                <HostActionCard botId={botId} messageId={message.id} block={block} />
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
            // Pictures posted together sit in one row, under the first of them.
            if (message.blocks[i - 1]?.kind === "image") return null;
            const row: Array<[number, Extract<MessageBlock, { kind: "image" }>]> = [];
            for (let j = i; message.blocks[j]?.kind === "image"; j++)
              row.push([j, message.blocks[j] as Extract<MessageBlock, { kind: "image" }>]);
            return (
              <div key={i} className="flex flex-wrap justify-start gap-2">
                {row.map(([index, image]) => (
                  <ArtifactImage
                    key={index}
                    target={artifactTarget}
                    artifactId={image.artifactId}
                    name={image.name}
                    onAsk={
                      message.role === "bot" && onImageAsk
                        ? (artifactId, ask) => onImageAsk(message, artifactId, ask)
                        : undefined
                    }
                  />
                ))}
              </div>
            );
          }
          if (block.kind === "file") {
            return (
              <div key={i} className="flex justify-start">
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
          if (block.kind === "text" && message.role === "user") {
            // A person sits in the same column as the agents, with no bubble. Their text stays literal:
            // only explicit URLs and email addresses are links.
            return (
              <div key={i} className="flex w-fit max-w-full justify-start">
                <div
                  data-testid="message-user-bubble"
                  data-quote-message-id={quoteMessageId}
                  className="max-w-full whitespace-pre-wrap wrap-anywhere text-message text-foreground"
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
                className="flex w-fit max-w-full justify-start [@media(hover:none)]:w-full [@media(hover:none)]:flex-wrap"
              >
                <div data-testid="message-bot-bubble" className={botBubble} dir="auto">
                  <div data-quote-message-id={quoteMessageId}>
                    <ChatMarkdown renderMention={renderMention}>
                      {approvalTextLabel(block.text)}
                    </ChatMarkdown>
                  </div>
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
                    <div key={line.k} className="flex items-baseline gap-2.5 text-name">
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
                  <p className="mb-1.5 text-body2 text-muted-foreground">
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
                  approver={
                    speakerName
                      ? {
                          agentName: speakerName,
                          owns: Boolean(ownerUserId) && ownerUserId === viewerUserId,
                        }
                      : undefined
                  }
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
                  <span className="text-name font-medium text-foreground">
                    <Trans>Computer</Trans>
                  </span>
                  <span
                    className={
                      block.state === "Needs you"
                        ? "rounded-full bg-warning/15 px-[11px] py-1 text-body2 text-warning"
                        : block.state === "Skipped"
                          ? "rounded-full bg-foreground/10 px-[11px] py-1 text-body2 text-muted-foreground"
                          : "rounded-full bg-success/15 px-[11px] py-1 text-body2 text-success"
                    }
                  >
                    {block.state}
                  </span>
                </div>
                <div className="my-2.5 text-message text-foreground/75">
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
        {message.role === "user" && channelMembers && message.routingReport ? (
          showsRouting(message.routingReport) ? (
            <RoutingLine
              report={message.routingReport}
              agent={(botId) => {
                const bot = peerBot(botId);
                const name = bot?.name ?? memberName?.(botId);
                return name ? { name, color: bot?.color ?? FALLBACK_BOT_COLOR } : undefined;
              }}
            />
          ) : null
        ) : null}
      </div>
    </ChannelRow>
  );
});

/** A channel message: the agent's face in a column of its own, the message beside it. Others are as they are. */
function ChannelRow({ avatar, children }: { avatar: ReactNode; children: ReactNode }) {
  if (!avatar) return <>{children}</>;
  return (
    <div className="relative -mx-2 flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50 focus-within:bg-muted/50 motion-reduce:transition-none">
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
