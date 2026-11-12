import type { UserMemory, UserMemoryDecision, UserMemoryState } from "@corvo/contracts";
import { rpc } from "./api";

/** What the person's agents know about them; `["pending"]` is what waits for Save. */
export function listYouMemories(state?: UserMemoryState[]) {
  return rpc("you/list", { state });
}

export function getYouMemory(memoryId: string) {
  return rpc("you/get", { memoryId });
}

export function decideYouMemory(
  memoryId: string,
  decision: UserMemoryDecision,
): Promise<UserMemory | null> {
  return rpc("you/decide", { memoryId, decision });
}
