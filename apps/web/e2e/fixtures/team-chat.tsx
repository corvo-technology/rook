import type { GroupMember, MessageBlock, ThreadMessage } from "@corvo/contracts";
import { BOT_COLOR_LIST, foldPeerReplies, foldThreadReplies } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { ChannelFind, pinSignature } from "../../src/pages/shell/channel-find";
import { ChannelHeader } from "../../src/pages/shell/channel-header";
import { Transcript } from "../../src/pages/shell/transcript";

// The #finance channel of the team-chat design over fake messages: people and agents together, a
// routine's message, a run's tools folded into one line, a pinned message, a reaction and an
// approval that is decided by holding. Pins, search and the jump are inert here (the spec answers
// the two RPCs); a jump is written to the page as `data-jumped`. State lives in the URL (?theme).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const MEMBERS: GroupMember[] = [
  { botId: "chief", name: "Rook", color: color("purple") },
  { botId: "bento", name: "Bento", color: color("blue") },
  { botId: "cora", name: "Cora", color: color("green") },
];
const bot = (botId: string | undefined) => MEMBERS.find((member) => member.botId === botId);

let seq = 0;
function message(
  role: ThreadMessage["role"],
  blocks: MessageBlock[],
  extra: Partial<ThreadMessage> = {},
): ThreadMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    threadId: "thread-1",
    seq,
    role,
    blocks,
    createdAt: new Date(Date.UTC(2026, 10, 10, 8, seq * 3)).toISOString(),
    ...extra,
  };
}

const morning = message(
  "bot",
  [
    {
      kind: "text",
      text: "Good morning. 38 entries came in yesterday and 37 matched the bank. One does not: 12.90 too much.",
    },
  ],
  { botId: "cora", routineName: "Daily reconciliation" },
);
const question = message("user", [
  {
    kind: "text",
    text: "@Bento can you check that difference? I think the bill fee was entered twice.",
  },
]);
const found = message(
  "bot",
  [
    {
      kind: "steps",
      steps: [
        { label: "Using erp_find_entries", count: 2 },
        { label: "Using bank_get_statement", count: 1 },
      ],
      durationMs: 40_000,
    },
    {
      kind: "text",
      text: "It was: the 12.90 fee went into the ERP twice. I removed the duplicate and the balance matches the bank.",
    },
  ],
  { botId: "bento", pinnedAt: "2026-11-10T09:30:00.000Z" },
);
const thanks = message("user", [{ kind: "text", text: "👍" }], { replyToMessageId: found.id });
const approval = message(
  "bot",
  [
    {
      kind: "ask",
      text: "Send the October close to the accountant?",
      approvalEffectId: "effect-1",
      status: "pending",
      detail:
        "Gmail · send_email\nto: accountant@office.example\nattachment: income-statement-october.xlsx",
      detailFormat: "code",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    },
  ],
  { botId: "cora", runId: "run-1" },
);
const INITIAL = [morning, question, found, thanks, approval];

function TeamChat() {
  const [messages, setMessages] = useState(INITIAL);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcript = useMemo(
    () => foldThreadReplies(foldPeerReplies(messages, { includePeerReceipts: true })),
    [messages],
  );
  const answerable = useMemo(
    () =>
      new Set(
        messages
          .filter((item) => item.id === approval.id)
          .filter((item) =>
            item.blocks.some((block) => block.kind === "ask" && block.status !== "answered"),
          )
          .map((item) => item.id),
      ),
    [messages],
  );
  const noop = () => {};
  const resolved = async () => {};
  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground">
      <ChannelHeader
        name="finance"
        purpose="Closing, bills and reconciliation"
        members={MEMBERS}
        onOpenNavigation={noop}
        onOpenSettings={noop}
        onOpenSquad={noop}
        find={
          <ChannelFind
            groupId="group-1"
            channelName="finance"
            pins={pinSignature(messages)}
            memberName={(botId) => bot(botId)?.name}
            onJump={(messageId) => {
              document.body.dataset.jumped = messageId;
            }}
          />
        }
      />
      <main className="flex min-h-0 flex-1 flex-col pt-12">
        <Transcript
          artifactTarget={{ groupId: "group-1" }}
          showToolActivity
          answerableAskIds={answerable}
          dismissableAskIds={new Set()}
          onOpenBot={noop}
          onAnswer={async (_item, text) =>
            setMessages((current) =>
              current.map((item) =>
                item.id === approval.id
                  ? {
                      ...item,
                      blocks: item.blocks.map((block) =>
                        block.kind === "ask"
                          ? { ...block, status: "answered", answer: text }
                          : block,
                      ),
                    }
                  : item,
              ),
            )
          }
          onPin={async (target, pinned) =>
            setMessages((current) =>
              current.map((item) =>
                item.id === target.id
                  ? { ...item, pinnedAt: pinned ? new Date().toISOString() : undefined }
                  : item,
              ),
            )
          }
          onMarkUnread={noop}
          onReact={resolved}
          onJumpToMessage={noop}
          onOpenPeerMessages={noop}
          memberName={(botId) => bot(botId)?.name}
          members={MEMBERS}
          peerBot={(botId) => bot(botId) ?? MEMBERS[0]!}
          onRefresh={resolved}
          onBotChanged={resolved}
          onAddRoutine={noop}
          voiceReady={false}
          speakingMessageId={null}
          onSpeak={noop}
          onOpenComputer={noop}
          scrollRef={scrollRef}
          scrollRequest={null}
          onScrollRequestHandled={noop}
          transcript={transcript}
          olderCursor={null}
          unreadAfterSeq={null}
          loadingOlder={false}
          running={false}
          workingBots={[]}
          onLoadOlder={noop}
          onReply={noop}
          onQuote={noop}
        />
      </main>
    </div>
  );
}

await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <TeamChat />
  </I18nProvider>,
);
