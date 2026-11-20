import type { ChatModelChoice } from "@corvo/core";
import { createMessageModelStore, messageModelOptions } from "@corvo/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { rpc } from "./api";

/** What the composer sends next for one agent's chat; kept for the session, never saved to the agent. */
export const messageModels = createMessageModelStore();

export function useMessageModel(botId: string) {
  return useSyncExternalStore(messageModels.subscribe, () => messageModels.get(botId));
}

export type MessageModelOptions = { choices: ChatModelChoice[]; agentKey: string };

/** The models this agent's next message can run on, or `null` while loading or when there is no choice. */
export function useMessageModelOptions(botId: string): MessageModelOptions | null {
  const [options, setOptions] = useState<MessageModelOptions | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      const [me, catalog, credentials, bot] = await Promise.all([
        rpc("me"),
        rpc("models/list"),
        rpc("models/credentials"),
        rpc("bots/get", { botId }),
      ]);
      const billing = me.billingEnabled ? await rpc("billing/status") : null;
      if (active) {
        setOptions(messageModelOptions({ credentials, catalog, billing, bot, me }));
      }
    })().catch(() => {
      // Without the list the composer simply offers no choice and sends on the agent's model.
      if (active) setOptions(null);
    });
    return () => {
      active = false;
    };
  }, [botId]);
  return options;
}
