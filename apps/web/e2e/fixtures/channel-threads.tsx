import type { GroupMember, MessageBlock, ThreadMessage } from "@corvo/contracts";
import { BOT_COLOR_LIST, foldPeerReplies, foldThreadReplies } from "@corvo/core";
import type { GroupAvatarMember } from "@corvo/ui-web";
import { I18nProvider } from "@lingui/react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkingLine } from "../../src/components/WorkingLine";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { ThreadPanel } from "../../src/pages/shell/thread-panel";
import { Transcript } from "../../src/pages/shell/transcript";

// A channel with threads over fake messages: replies folded under their roots, the thread open
// beside the channel, and the working line above the composer. State lives in the URL
// (?theme=light|dark&working=0..4&open).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const MEMBERS: GroupMember[] = [
  { botId: "chief", name: "Chief", color: color("purple") },
  { botId: "bento", name: "Bento", color: color("green") },
  { botId: "cora", name: "Cora", color: color("red") },
  { botId: "leo", name: "Leo", color: color("blue") },
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
const person = (text: string, extra?: Partial<ThreadMessage>) =>
  message("user", [{ kind: "text", text }], extra);
const said = (botId: string, text: string, extra?: Partial<ThreadMessage>) =>
  message("bot", [{ kind: "text", text }], { botId, ...extra });

const ask = person("Can we get the launch post and its numbers ready by Friday?");
const handoff = message(
  "bot",
  [{ kind: "handoff", fromBotId: "chief", toBotId: "bento", text: "Draft the launch post." }],
  { botId: "chief" },
);
const MESSAGES: ThreadMessage[] = [
  ask,
  said("chief", "On it. I am handing the draft to Bento and the numbers to Cora."),
  handoff,
  said("bento", "Draft is up: three short paragraphs and one image.", { threadRootId: handoff.id }),
  said("cora", "The numbers match last quarter, one chart attached.", { threadRootId: handoff.id }),
  person("Make the opening shorter.", { threadRootId: handoff.id }),
  said("bento", "Done, the opening is two lines now.", { threadRootId: handoff.id }),
  said("leo", "Anything else you need from me today?"),
];

const noop = () => {};
const resolved = async () => {};
const none = new Set<string>();

function Channel() {
  const [openId, setOpenId] = useState<string | null>(params.has("open") ? handoff.id : null);
  const [messages, setMessages] = useState(MESSAGES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcript = useMemo(
    () => foldThreadReplies(foldPeerReplies(messages, { includePeerReceipts: true })),
    [messages],
  );
  const root = openId ? transcript.messages.find((item) => item.id === openId) : undefined;
  const working: GroupAvatarMember[] = MEMBERS.slice(0, Number(params.get("working") ?? 0)).map(
    (member) => ({ ...member, status: "running" }),
  );
  const shared = {
    artifactTarget: { groupId: "group-1" },
    showToolActivity: false,
    answerableAskIds: none,
    dismissableAskIds: none,
    onOpenBot: noop,
    onAnswer: resolved,
    onMarkUnread: noop,
    onReact: resolved,
    onJumpToMessage: noop,
    onOpenPeerMessages: noop,
    memberName: (botId: string | undefined) => bot(botId)?.name,
    members: MEMBERS,
    peerBot: (botId: string) => bot(botId) ?? MEMBERS[0]!,
    onRefresh: resolved,
    onBotChanged: resolved,
    onAddRoutine: noop,
    voiceReady: false,
    speakingMessageId: null,
    onSpeak: noop,
    onOpenComputer: noop,
  };
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <main className="flex min-w-0 flex-1 flex-col">
        <Transcript
          {...shared}
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
          onOpenThread={setOpenId}
          openThreadId={openId}
        />
        <div className="flex flex-col gap-2 px-6 pb-4">
          <WorkingLine bots={working} />
          <div className="h-12 rounded-[26px] border border-border" />
        </div>
      </main>
      {root ? (
        <aside className="flex w-96 shrink-0 border-s border-border">
          <ThreadPanel
            key={root.id}
            root={root}
            replies={transcript.folded.get(root.id) ?? []}
            transcriptProps={shared}
            scrollRequest={null}
            onScrollRequestHandled={noop}
            enterToSend
            mentionTargets={MEMBERS.map((member) => ({
              kind: "bot" as const,
              id: member.botId,
              name: member.name,
              color: member.color,
            }))}
            onSend={async (text) => {
              setMessages((current) => [...current, person(text, { threadRootId: root.id })]);
            }}
            onClose={() => setOpenId(null)}
          />
        </aside>
      ) : null}
    </div>
  );
}

await bootstrapI18n("en");
createRoot(document.getElementById("root")!).render(
  <I18nProvider i18n={i18n}>
    <Channel />
  </I18nProvider>,
);
