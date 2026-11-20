import { createMessageModelStore } from "@corvo/core";
import { useSyncExternalStore } from "react";

/** What a composer sends next for one agent's chat; kept for the session, never saved to the agent. */
export const messageModels = createMessageModelStore();

export function useMessageModel(botId: string) {
  return useSyncExternalStore(messageModels.subscribe, () => messageModels.get(botId));
}
