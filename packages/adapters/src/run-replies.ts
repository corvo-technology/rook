import type { MessageBlock } from "@corvo/contracts";
import { isAutonomousRunTrigger, isBackgroundRunTrigger } from "@corvo/core";
import { NO_RESPONSE } from "./silent-reply.js";
import { messageUserMaxLength } from "./user-progress.js";

export function longWorkProgressGuidance(maxLength = messageUserMaxLength()): string {
  return `Send progress updates only when the work will take minutes — long computer tasks or multi-step jobs — never for quick replies and never to announce that you are starting. Even then send at most a few brief updates (a sentence or two each), not one per tool call, and do not narrate routine steps. Thinking stays private. message_user is capped at ${maxLength} characters and will be silently cut off if you exceed it \u2014 never put your final answer, a report, or any long-form deliverable in it. Always put the complete final answer in your normal reply, never split across message_user calls, and never assume a message_user update already delivered your content.`;
}

/** Shape of a message nobody asked for: what a chief of staff sends once the analysis is done. */
export const PROACTIVE_MESSAGE_GUIDANCE =
  "When you do speak, write like a person who helps them, in the language they use with you, in 2 to 4 sentences: the concrete facts (names, dates, numbers), the analysis and your recommendation already done, anything you already did, and at most one question or offer at the end. Never hand the work back with an open question about what to look into; look into it. No greeting, headings or lists.";

export const ROUTINE_SILENT_REPLY_GUIDANCE = `No one is waiting on this run. Speak only when something needs the person. When the task only asks you to watch or check and nothing needs them, the entire final assistant reply must be exactly ${NO_RESPONSE} — no surrounding prose, no variants, no progress updates, no all-clear, no filler, and no meta note that you are staying silent. Do not call message_user unless you have something to report. A report, summary or reminder the task explicitly asks for is delivered. ${PROACTIVE_MESSAGE_GUIDANCE}`;

export const REACTION_SILENT_REPLY_GUIDANCE = `The user reacted with an emoji to your message. Reply only if the reaction calls for it, such as a correction after 👎, a go-ahead on something you proposed, or a question. Otherwise the entire final assistant reply must be exactly ${NO_RESPONSE}, with no message_user call.`;

export function runAllowsSilentEmpty(trigger: string): boolean {
  return trigger === "reaction" || isAutonomousRunTrigger(trigger);
}

/**
 * Whether text written before a tool call may become a durable mid-turn chat bubble.
 * Routine and bot-to-bot runs hold it back, using the last segment as the final reply
 * only when the model supplies none and has not explicitly chosen silence.
 * Background runs never promote it.
 */
export function runPromotesMidTurnNarration(trigger: string): boolean {
  return trigger !== "bot_message" && !isAutonomousRunTrigger(trigger);
}

export const TICKET_SILENT_REPLY_GUIDANCE = [
  "Ticket work is reported on the board, not in chat. Put updates and results in ticket_comment and keep the ticket status current with ticket_update. Use the existing ask or approval mechanism when user input is needed. Leave the final reply empty.",
  "Do what the ticket asks and nothing more: do not invent policies, processes, constraints or blockers the person did not ask for. If a real legal or safety risk exists, mention it in one line.",
  "Work to the ticket's acceptance criteria. Do big jobs in batches: after each batch, save the result in a file and a short checkpoint comment (done so far, what is left), then compare progress with the criteria. If they are not met and you can still make progress, keep going. If you must stop with work left, call ticket_update with remaining instead of moving the ticket: you are woken again to continue from your checkpoint. Move the ticket to review only when the criteria are met or you are truly blocked, and in a comment say what is done, what is missing and what blocks you.",
  "Keep any message to another agent or to the chat to 2 to 4 sentences with a reference to the full result (the file, ticket or wiki page). Never paste the whole document.",
].join(" ");

export function runReplyGuidance(trigger: string): string {
  if (trigger === "reaction") return REACTION_SILENT_REPLY_GUIDANCE;
  if (isBackgroundRunTrigger(trigger)) return TICKET_SILENT_REPLY_GUIDANCE;
  return isAutonomousRunTrigger(trigger)
    ? ROUTINE_SILENT_REPLY_GUIDANCE
    : longWorkProgressGuidance();
}

export function replyGuidanceForOfferedTools(
  guidance: string,
  disabled?: ReadonlySet<string>,
): string | undefined {
  if (!disabled?.has("message_user")) return guidance;
  if (guidance === longWorkProgressGuidance()) {
    return "Always put the complete final answer in your normal reply.";
  }
  if (guidance === REACTION_SILENT_REPLY_GUIDANCE) {
    return guidance.replace(", with no message_user call.", ".");
  }
  if (guidance === ROUTINE_SILENT_REPLY_GUIDANCE) {
    return guidance.replace(" Do not call message_user unless you have something to report.", "");
  }
  return guidance.includes("message_user") ? undefined : guidance;
}

export const DELEGATED_EMPTY_NOTICE =
  "The delegated bot completed its turn without a written summary.";

/** Failure used when a tool-bearing turn would otherwise complete as the empty notice. */
export const TOOL_STEPS_WITHOUT_RESPONSE =
  "The model finished its tool steps without a written response.";

/** True when the only written completion is the empty delegated notice after tool steps. */
export function emptyDelegatedToolTurnShouldFail(blocks: MessageBlock[]): boolean {
  const text = blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  return text === DELEGATED_EMPTY_NOTICE && blocks.some((block) => block.kind === "steps");
}

export function completionMessageSegments(
  segments: MessageBlock[],
  options?: {
    allowSilentEmpty?: boolean;
    emptyResponseText?: string;
    suppressOutput?: boolean;
    skipEmptyFallback?: boolean;
  },
): MessageBlock[] {
  if (options?.suppressOutput) return [];
  const fallback = options?.emptyResponseText?.trim() || "done.";
  if (segments.length > 0) {
    if (
      !options?.allowSilentEmpty &&
      options?.emptyResponseText !== undefined &&
      !segments.some((segment) => segment.kind === "text" && segment.text)
    ) {
      return [...segments, { kind: "text", text: fallback }];
    }
    return segments;
  }
  if (options?.allowSilentEmpty || options?.skipEmptyFallback) return [];
  return [{ kind: "text", text: fallback }];
}
