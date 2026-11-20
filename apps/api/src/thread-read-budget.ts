import type { ComputerCommand, ProductEvent, ThreadMessage } from "@corvo/contracts";
import { ComputerCommandSchema, THREAD_READ_BUDGET } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";

export interface MessageWindowBudget {
  maxMessages: number;
  maxBytes: number;
  /** Stop at the oldest of this many user messages, so the window opens on a whole turn. */
  maxUserTurns?: number;
}

/** The first `chars` characters of `text`, never ending inside a surrogate pair. */
function head(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const end = /[\uD800-\uDBFF]/.test(text[chars - 1] ?? "") ? chars - 1 : chars;
  return text.slice(0, end);
}

/**
 * The message with a helper's report cut to a preview. `truncated` tells the client the full text
 * is one `threads.message` read away; the same message is returned unchanged when nothing is long.
 */
export function previewMessage(message: ThreadMessage): ThreadMessage {
  const limit = THREAD_READ_BUDGET.previewChars;
  let changed = false;
  const blocks = message.blocks.map((block) => {
    if (block.kind !== "subagent") return block;
    if ((block.result?.length ?? 0) <= limit && (block.progress?.length ?? 0) <= limit) {
      return block;
    }
    changed = true;
    return {
      ...block,
      result: block.result === undefined ? undefined : head(block.result, limit),
      progress: block.progress === undefined ? undefined : head(block.progress, limit),
      truncated: true as const,
    };
  });
  return changed ? { ...message, blocks } : message;
}

/** A command with its output cut to a preview; the full output comes from `computer.commandOutput`. */
export function previewCommand<T extends ComputerCommand>(command: T): T {
  const limit = THREAD_READ_BUDGET.previewChars;
  if (command.output.length <= limit) return command;
  return { ...command, output: head(command.output, limit), outputTruncated: true };
}

/** A live command event with its output cut to a preview, like the history `computer.commands` reads. */
export function previewCommandEvent<E extends ProductEvent>(event: E): E {
  if (event.type !== "computer.command") return event;
  const parsed = ComputerCommandSchema.safeParse(event.payload);
  if (!parsed.success) return event;
  const preview = previewCommand(parsed.data);
  return preview === parsed.data ? event : { ...event, payload: { ...event.payload, ...preview } };
}

/**
 * The newest messages of an oldest-first page that fit the budget. The newest message is always
 * kept, so a single huge one cannot leave a page empty and stall paging.
 */
export function boundMessageWindow(
  messages: ThreadMessage[],
  budget: MessageWindowBudget,
): { messages: ThreadMessage[]; trimmed: boolean } {
  let bytes = 0;
  let userTurns = 0;
  let start = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message) continue;
    const size = Buffer.byteLength(JSON.stringify(message));
    const kept = messages.length - index - 1;
    if (kept > 0 && (kept >= budget.maxMessages || bytes + size > budget.maxBytes)) break;
    bytes += size;
    start = index;
    if (message.role === "user" && budget.maxUserTurns !== undefined) {
      userTurns += 1;
      if (userTurns >= budget.maxUserTurns) break;
    }
  }
  return start === 0
    ? { messages, trimmed: false }
    : { messages: messages.slice(start), trimmed: true };
}

export type ResumePlan = { replay: true } | { replay: false; head: number };

/**
 * Whether the events after `cursor` are few and small enough to replay. Reads at most one more
 * than the event budget, with each payload's stored size, never the payloads themselves.
 */
export async function planResume(
  prisma: Pick<PrismaClient, "$queryRaw">,
  threadId: string,
  cursor: number,
): Promise<ResumePlan> {
  const { maxEvents, maxBytes } = THREAD_READ_BUDGET.resume;
  const rows = await prisma.$queryRaw<Array<{ seq: number; bytes: number }>>`
    SELECT seq, pg_column_size(payload)::int AS bytes
    FROM events
    WHERE "threadId" = ${threadId} AND seq > ${cursor}
    ORDER BY seq ASC
    LIMIT ${maxEvents + 1}`;
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  if (rows.length <= maxEvents && total <= maxBytes) return { replay: true };
  const [latest] = await prisma.$queryRaw<Array<{ seq: number }>>`
    SELECT max(seq)::int AS seq FROM events WHERE "threadId" = ${threadId}`;
  return { replay: false, head: latest?.seq ?? cursor };
}
