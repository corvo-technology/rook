import type { GroupMember, MessageBlock, ThreadMessage } from "@corvo/contracts";
import { BOT_COLOR_LIST, foldPeerReplies, foldThreadReplies } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { Transcript } from "../../src/pages/shell/transcript";

// A channel where the router chose who answers, over fake messages: who it picked, and a message
// nobody answered. State lives in the URL (?theme=light|dark).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const MEMBERS: GroupMember[] = [
  { botId: "cto", name: "CTO", color: color("blue") },
  { botId: "fin", name: "Financeiro", color: color("green") },
  { botId: "chief", name: "Rook", color: color("purple") },
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
    createdAt: new Date(Date.UTC(2026, 10, 10, 9, seq * 3)).toISOString(),
    ...extra,
  };
}
const text = (value: string): MessageBlock[] => [{ kind: "text", text: value }];

const MESSAGES: ThreadMessage[] = [
  message("user", text("Can someone check last month's invoices and why the deploy failed?"), {
    authorUserId: "ana",
    authorName: "Ana",
    routingReport: {
      by: "router",
      note: "Invoices and a build failure",
      agents: [
        { botId: "cto", reason: "router_picked" },
        { botId: "fin", reason: "router_picked" },
        { botId: "chief", reason: "not_in_audience" },
      ],
    },
  }),
  message("bot", text("The deploy failed on a missing environment variable. I am fixing it."), {
    botId: "cto",
  }),
  message("user", text("thanks, both"), {
    authorUserId: "ana",
    authorName: "Ana",
    routingReport: {
      by: "router",
      note: "A thank-you",
      agents: [
        { botId: "cto", reason: "none_needed" },
        { botId: "fin", reason: "none_needed" },
        { botId: "chief", reason: "none_needed" },
      ],
    },
  }),
];

function Channel() {
  const messages = MESSAGES;
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcript = useMemo(
    () => foldThreadReplies(foldPeerReplies(messages, { includePeerReceipts: true })),
    [messages],
  );
  const noop = () => {};
  const resolved = async () => {};
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <main className="flex min-w-0 flex-1 flex-col">
        <Transcript
          artifactTarget={{ groupId: "group-1" }}
          showToolActivity={false}
          answerableAskIds={new Set()}
          dismissableAskIds={new Set()}
          onOpenBot={noop}
          onAnswer={async () => {}}
          onApproveAll={async () => []}
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
    <Channel />
  </I18nProvider>,
);
