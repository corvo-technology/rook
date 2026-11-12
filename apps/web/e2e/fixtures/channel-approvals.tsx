import type { GroupMember, MessageBlock, ThreadMessage } from "@corvo/contracts";
import { BOT_COLOR_LIST, foldPeerReplies, foldThreadReplies } from "@corvo/core";
import { I18nProvider } from "@lingui/react";
import { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { bootstrapI18n, i18n } from "../../src/lib/i18n";
import { applyResolvedAppearance } from "../../src/lib/ui-appearance";
import "../../src/styles.css";
import { Transcript } from "../../src/pages/shell/transcript";

// A channel where several agents wait on an approval, over fake messages. The fake batch decides
// every card, except the last when ?fail is set. State lives in the URL (?theme=light|dark&fail).

const params = new URLSearchParams(location.search);
applyResolvedAppearance(params.get("theme") === "dark" ? "dark" : "light");

const color = (id: string) => BOT_COLOR_LIST.find((item) => item.id === id)?.hex ?? "#3B82F6";
const MEMBERS: GroupMember[] = [
  { botId: "chief", name: "Chief", color: color("purple") },
  { botId: "bento", name: "Bento", color: color("green") },
  { botId: "cora", name: "Cora", color: color("red") },
];
const bot = (botId: string | undefined) => MEMBERS.find((member) => member.botId === botId);

const actions = [
  { id: "allow", label: "Allow once" },
  { id: "always", label: "Always allow this tool" },
  { id: "deny", label: "Deny" },
];

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
const approval = (botId: string, effectId: string, text: string) =>
  message("bot", [{ kind: "ask", text, approvalEffectId: effectId, status: "pending", actions }], {
    botId,
    runId: `run-${effectId}`,
  });

const INITIAL: ThreadMessage[] = [
  message("user", [{ kind: "text", text: "Send the launch note and update the tracker." }]),
  approval("chief", "e1", "Send the launch note to the team?"),
  approval("bento", "e2", "Post the draft to the blog?"),
  approval("cora", "e3", "Update the revenue sheet?"),
];
const waiting = new Set(INITIAL.filter((item) => item.runId).map((item) => item.id));

function Channel() {
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
          .filter((item) => waiting.has(item.id))
          .filter((item) =>
            item.blocks.some((block) => block.kind === "ask" && block.status !== "answered"),
          )
          .map((item) => item.id),
      ),
    [messages],
  );
  const decide = (effectIds: string[]) =>
    setMessages((current) =>
      current.map((item) =>
        item.blocks.some(
          (block) => block.kind === "ask" && effectIds.includes(block.approvalEffectId ?? ""),
        )
          ? {
              ...item,
              blocks: item.blocks.map((block) =>
                block.kind === "ask" ? { ...block, status: "answered", answer: "allow" } : block,
              ),
            }
          : item,
      ),
    );
  const noop = () => {};
  const resolved = async () => {};
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <main className="flex min-w-0 flex-1 flex-col">
        <Transcript
          artifactTarget={{ groupId: "group-1" }}
          showToolActivity={false}
          answerableAskIds={answerable}
          dismissableAskIds={new Set()}
          onOpenBot={noop}
          onAnswer={async (item, _text, _username, _dismiss, effectId) =>
            decide(
              effectId
                ? [effectId]
                : item.blocks.flatMap((block) =>
                    block.kind === "ask" && block.approvalEffectId ? [block.approvalEffectId] : [],
                  ),
            )
          }
          onApproveAll={async (_batchClass, items) => {
            const failing = params.has("fail") ? items.slice(-1) : [];
            decide(
              items.filter((item) => !failing.includes(item)).map((item) => item.approvalEffectId),
            );
            return failing.map((item) => item.approvalEffectId);
          }}
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
