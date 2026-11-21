import type { AgentRunRequest } from "@corvo/adapter-kit";
import { TOOL_RESULT_TEXT_LIMIT } from "./pi-runtime-limits.js";

export const READ_RESULT_TOOL = "read_result";

/**
 * The one line that tells the model where the whole output is kept. Context shortening keeps it
 * (see `splitResultHandleNote`), so an older, shorter result still points at its full text.
 */
const NOTE_RE =
  /\[Output truncated: [\d,]+ chars total\. Full text kept as handle (\S+?); [^\]]*\]/;

function handleNote(total: number, handle: string): string {
  return `[Output truncated: ${total.toLocaleString("en-US")} chars total. Full text kept as handle ${handle}; read more with ${READ_RESULT_TOOL} {handle, offset, length} or {handle, grep}, or narrow the original request.]`;
}

/** Head and tail of an over-long text, joined by the handle note. */
export function truncateWithHandle(
  text: string,
  handle: string,
  limit: number = TOOL_RESULT_TEXT_LIMIT,
): string {
  const note = handleNote(text.length, handle);
  const room = Math.max(0, limit - note.length - 6);
  const head = Math.floor(room * 0.7);
  const tail = room - head;
  return `${text.slice(0, head)}\n…\n${tail > 0 ? text.slice(-tail) : ""}\n${note}`;
}

/** The handle note at the end of a truncated result, separated from the text before it. */
export function splitResultHandleNote(text: string): { body: string; note: string } | undefined {
  const match = NOTE_RE.exec(text);
  if (!match) return undefined;
  return {
    body: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trimEnd(),
    note: match[0],
  };
}

/**
 * Keep the whole of an over-long result behind a handle and return what the model sees now.
 * Undefined means nothing was kept (no store, a failure, or the run's share is used up), so the
 * caller clips as it always did; a stored result never fails the tool call.
 */
export async function keepWholeResult(
  request: Pick<AgentRunRequest, "storeToolResult">,
  input: { name: string; executionId: string; text: string },
): Promise<string | undefined> {
  if (!request.storeToolResult || input.name === READ_RESULT_TOOL) return undefined;
  if (input.text.length <= TOOL_RESULT_TEXT_LIMIT) return undefined;
  try {
    const handle = await request.storeToolResult({
      name: input.name,
      executionId: input.executionId,
      text: input.text,
    });
    return handle ? truncateWithHandle(input.text, handle) : undefined;
  } catch {
    return undefined;
  }
}
