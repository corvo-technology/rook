import type { Bot } from "@corvo/contracts";
import { lazyOverlay } from "../../components/ErrorBoundary";
import { FALLBACK_BOT_COLOR } from "./chat-shared";

const PeerMessagesOverlay = lazyOverlay(() =>
  import("../PeerMessagesOverlay").then((module) => module.PeerMessagesOverlay),
);

/** A bot's conversation with another bot. */
export function PeerConversationOverlay({
  peerConversation,
  setPeerConversation,
  active,
  peerBot,
}: {
  peerConversation: { peerBotId: string; peerBotName: string } | null;
  setPeerConversation: (peer: null) => void;
  active: Bot | undefined;
  peerBot: (botId: string) => { color: string } | undefined;
}) {
  return peerConversation && active ? (
    <PeerMessagesOverlay
      botId={active.id}
      botName={active.name}
      botColor={active.color}
      peerBotId={peerConversation.peerBotId}
      peerBotName={peerConversation.peerBotName}
      peerBotColor={peerBot(peerConversation.peerBotId)?.color ?? FALLBACK_BOT_COLOR}
      onClose={() => setPeerConversation(null)}
    />
  ) : null;
}
