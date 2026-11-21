import type { AvatarMood, AvatarState } from "open-bot-avatar";

/** What an agent's avatar shows: what it is doing, how it feels, and whether it is asleep. */
export type AvatarLook = { state: AvatarState; mood: AvatarMood; asleep: boolean };

const IDLE: AvatarLook = { state: "idle", mood: "neutral", asleep: false };

/**
 * One mapping from an agent's run status to its avatar, for every surface. Waiting in line is
 * thinking, a run in progress is working, a pause on a person is waiting, a failure is blocked, and
 * work that just ended well is done, happy, until the caller lets it fall back to idle. Mood stays
 * neutral unless something ended well: nothing here reads sentiment.
 */
export function avatarLook(status: string | undefined, justFinished: boolean): AvatarLook {
  switch (status) {
    case "queued":
    case "leased":
      return { ...IDLE, state: "thinking" };
    case "running":
      return { ...IDLE, state: "working" };
    case "waiting_input":
    case "waiting_takeover":
      return { ...IDLE, state: "waiting" };
    case "failed":
      return { ...IDLE, state: "blocked" };
    case "asleep":
      return { ...IDLE, asleep: true };
    default:
      return justFinished ? { state: "done", mood: "happy", asleep: false } : IDLE;
  }
}

/** How long a finished agent celebrates before it rests: one turn of the avatar's celebration. */
export const AVATAR_DONE_MS = 3_900;

/** A wait that outlasts this is more than a blink: the loader's avatar stops thinking and works. */
export const AGENT_LOADER_WORKING_AFTER_MS = 1_500;
