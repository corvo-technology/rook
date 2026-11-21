import type { MuteDuration, NotificationMute } from "@corvo/contracts";
import { useCallback, useState } from "react";
import { rpc } from "./api";
import type { InboxChatKind } from "./inbox-swipe";

export type MuteTarget = { botId: string } | { threadId: string };

/** What a row mutes: a bot by id, a group by its thread; null when the group's thread is unknown. */
export function muteTarget(
  kind: InboxChatKind,
  chat: { id: string; threadId?: string },
): MuteTarget | null {
  if (kind === "bot") return { botId: chat.id };
  return chat.threadId ? { threadId: chat.threadId } : null;
}

export function muteKey(target: MuteTarget | NotificationMute): string {
  return "botId" in target && target.botId
    ? `bot:${target.botId}`
    : `thread:${"threadId" in target ? target.threadId : ""}`;
}

/** The running mutes, loaded when the inbox focuses and after each change. */
export function useInboxMutes() {
  const [muted, setMuted] = useState<ReadonlySet<string>>(() => new Set());
  const load = useCallback(async () => {
    const mutes = await rpc("notifications/mutes");
    setMuted(new Set(mutes.map(muteKey)));
  }, []);
  const setMute = useCallback(
    async (target: MuteTarget, duration: MuteDuration | null) => {
      if (duration) await rpc("notifications/mute", { target, duration });
      else await rpc("notifications/unmute", target);
      await load();
    },
    [load],
  );
  return { muted, load, setMute };
}
