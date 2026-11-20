import type { MessageBlock } from "@corvo/contracts";
import { THREAD_READ_BUDGET } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it } from "vitest";
import { loadMessagePage } from "./thread-message-pages.js";
import {
  boundMessageWindow,
  planResume,
  previewCommand,
  previewCommandEvent,
  previewMessage,
} from "./thread-read-budget.js";

const THREAD = "thread-1";
const PAGE = 100;
const MIB = 1_048_576;

type Row = {
  id: string;
  threadId: string;
  seq: number;
  role: "user" | "bot";
  blocks: MessageBlock[];
  botId: string | null;
  replyToMessageId: null;
  replyQuote: null;
  runId: null;
  clientNonce: null;
  createdAt: Date;
};

/** Filler of an exact length, so every payload figure below is reproducible. */
const filler = (chars: number) => "x".repeat(chars);

/**
 * A long, heavy conversation: 2,000 turns of a short question and a 3 KB answer, and every fifth
 * turn a helper that reports 200 KB. Seqs are 0..3999, oldest first.
 */
function syntheticThread(turns = 2_000): Row[] {
  const rows: Row[] = [];
  const at = new Date("2026-01-01T00:00:00Z");
  for (let turn = 0; turn < turns; turn++) {
    const base = {
      threadId: THREAD,
      botId: "bot-1",
      replyToMessageId: null,
      replyQuote: null,
      runId: null,
      clientNonce: null,
      createdAt: at,
    } as const;
    rows.push({
      ...base,
      id: `m-${turn * 2}`,
      seq: turn * 2,
      role: "user",
      blocks: [{ kind: "text", text: `question ${turn}` }],
    });
    const blocks: MessageBlock[] = [{ kind: "text", text: filler(3_000) }];
    if (turn % 5 === 0) {
      blocks.push({
        kind: "subagent",
        agentId: `agent-${turn}`,
        name: "researcher",
        task: "Find the numbers",
        status: "completed",
        result: filler(200_000),
      });
    }
    rows.push({ ...base, id: `m-${turn * 2 + 1}`, seq: turn * 2 + 1, role: "bot", blocks });
  }
  return rows;
}

/** The slice of Prisma that reading a page touches, over rows held in memory. */
function fakePrisma(rows: Row[]) {
  return {
    message: {
      findMany: async ({ where, take }: { where: { seq?: { lt: number } }; take: number }) =>
        rows
          .filter((row) => where.seq === undefined || row.seq < where.seq.lt)
          .sort((a, b) => b.seq - a.seq)
          .slice(0, take)
          .map((row) => ({ ...row, replyTo: null })),
    },
    run: { findMany: async () => [] },
    user: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const userTurns = (page: { messages: Array<{ role: string }> }) =>
  page.messages.filter((message) => message.role === "user").length;

describe("thread read budget: cold open and history pages", () => {
  const thread = syntheticThread();
  const prisma = fakePrisma(thread);
  const open = (before?: number, preview = true) =>
    loadMessagePage(prisma, THREAD, before, PAGE, undefined, false, false, {
      budget: before === undefined ? THREAD_READ_BUDGET.coldOpen : THREAD_READ_BUDGET.historyPage,
      preview,
    });

  it("reads a whole page of the heavy thread when nothing bounds it", async () => {
    const page = await loadMessagePage(prisma, THREAD, undefined, PAGE);
    // The payload the read path returned before the budget: 100 rows, over 2 MiB.
    expect(page.messages).toHaveLength(100);
    expect(bytes(page)).toBeGreaterThan(2 * MIB);
  });

  it("opens on the last ten user turns, well under the byte budget", async () => {
    const page = await open();
    expect(userTurns(page)).toBe(THREAD_READ_BUDGET.coldOpen.maxUserTurns);
    expect(page.messages).toHaveLength(20);
    expect(page.messages[0]?.role).toBe("user");
    expect(bytes(page)).toBeLessThanOrEqual(THREAD_READ_BUDGET.coldOpen.maxBytes);
    expect(bytes(page)).toBeLessThan(40_000);
    expect(page.olderCursor).toBe(page.messages[0]?.seq);
  });

  it("holds the byte budget when the turns themselves are enormous", async () => {
    const huge = syntheticThread(30).map((row) =>
      row.role === "bot"
        ? { ...row, blocks: [{ kind: "text" as const, text: filler(400_000) }] }
        : row,
    );
    const page = await loadMessagePage(
      fakePrisma(huge),
      THREAD,
      undefined,
      PAGE,
      undefined,
      false,
      false,
      {
        budget: THREAD_READ_BUDGET.coldOpen,
      },
    );
    expect(bytes(page)).toBeLessThanOrEqual(THREAD_READ_BUDGET.coldOpen.maxBytes + 1_000);
    expect(page.messages).toHaveLength(4);
    expect(page.olderCursor).toBe(page.messages[0]?.seq);
  });

  it("pages older history without gaps or overlap, each page inside its budget", async () => {
    let page = await open();
    let seen = page.messages.length;
    let oldest = page.messages[0]?.seq ?? -1;
    const first = await open(page.olderCursor ?? undefined);
    expect(first.messages).toHaveLength(PAGE);
    expect(bytes(first)).toBeLessThanOrEqual(THREAD_READ_BUDGET.historyPage.maxBytes);
    // A history page of 100 rows with previews: pinned so a regression fails here.
    expect(bytes(first)).toBeLessThan(400_000);
    expect(first.messages.at(-1)?.seq).toBe(oldest - 1);
    page = first;
    seen += first.messages.length;
    oldest = first.messages[0]?.seq ?? -1;
    while (page.olderCursor !== null) {
      page = await open(page.olderCursor);
      expect(page.messages.at(-1)?.seq).toBe(oldest - 1);
      oldest = page.messages[0]?.seq ?? -1;
      seen += page.messages.length;
    }
    expect(seen).toBe(thread.length);
  });

  it("cuts a helper's long report to a preview that says it was cut", async () => {
    const page = await open();
    const helper = page.messages
      .flatMap((message) => message.blocks)
      .find((block) => block.kind === "subagent");
    expect(helper).toMatchObject({ kind: "subagent", truncated: true });
    expect(helper?.kind === "subagent" && helper.result?.length).toBe(
      THREAD_READ_BUDGET.previewChars,
    );
    const whole = await open(undefined, false);
    expect(
      whole.messages.flatMap((message) => message.blocks).find((b) => b.kind === "subagent"),
    ).not.toHaveProperty("truncated");
  });
});

describe("thread read budget: previews", () => {
  it("leaves short output and unrelated blocks alone", () => {
    const message = {
      id: "m",
      threadId: THREAD,
      seq: 1,
      role: "bot" as const,
      blocks: [
        { kind: "text" as const, text: filler(50_000) },
        {
          kind: "subagent" as const,
          agentId: "a",
          name: "n",
          task: "t",
          status: "completed" as const,
          result: filler(THREAD_READ_BUDGET.previewChars),
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
    };
    expect(previewMessage(message)).toBe(message);
  });

  it("does not split a surrogate pair at the cut", () => {
    const text = `${filler(THREAD_READ_BUDGET.previewChars - 1)}😀 and more`;
    const command = previewCommand({
      executionId: "e",
      kind: "shell",
      command: "ls",
      cwd: "/",
      status: "done",
      exitCode: 0,
      output: text,
    });
    expect(command.outputTruncated).toBe(true);
    expect(command.output).toBe(filler(THREAD_READ_BUDGET.previewChars - 1));
  });

  it("cuts a command event's output in the stream", () => {
    const event = {
      id: "e",
      spaceId: "s",
      threadId: THREAD,
      botId: "b",
      seq: 5,
      type: "computer.command" as const,
      createdAt: "2026-01-01T00:00:00Z",
      payload: {
        executionId: "x",
        kind: "shell",
        command: "yes",
        cwd: "/",
        status: "done",
        exitCode: 0,
        output: filler(16_000),
      },
    };
    const shown = previewCommandEvent(event);
    expect(shown.payload.output).toHaveLength(THREAD_READ_BUDGET.previewChars);
    expect(shown.payload.outputTruncated).toBe(true);
    expect(bytes(shown)).toBeLessThan(bytes(event) / 4);
  });
});

describe("boundMessageWindow", () => {
  const message = (seq: number, role: "user" | "bot", chars: number) => ({
    id: `m-${seq}`,
    threadId: THREAD,
    seq,
    role,
    blocks: [{ kind: "text" as const, text: filler(chars) }],
    createdAt: "2026-01-01T00:00:00Z",
  });

  it("always keeps the newest message, however large", () => {
    const window = boundMessageWindow([message(1, "user", 10), message(2, "bot", 5_000)], {
      maxMessages: 100,
      maxBytes: 100,
    });
    expect(window.messages.map((m) => m.seq)).toEqual([2]);
    expect(window.trimmed).toBe(true);
  });

  it("returns the page itself when it fits", () => {
    const page = [message(1, "user", 10), message(2, "bot", 10)];
    const window = boundMessageWindow(page, { maxMessages: 100, maxBytes: MIB, maxUserTurns: 10 });
    expect(window).toEqual({ messages: page, trimmed: false });
  });
});

describe("thread read budget: resuming a stream", () => {
  /** A thread's events by seq, each with a stored payload size, answering the two resume queries. */
  function eventsDb(sizes: number[]) {
    return {
      $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        if (strings.join("?").includes("max(seq)")) return [{ seq: sizes.length - 1 }];
        const cursor = values[1] as number;
        const limit = values[2] as number;
        return sizes
          .map((bytes, seq) => ({ seq, bytes }))
          .filter((row) => row.seq > cursor)
          .slice(0, limit);
      },
    } as unknown as PrismaClient;
  }
  const { maxEvents, maxBytes } = THREAD_READ_BUDGET.resume;

  it("replays a short backlog", async () => {
    expect(await planResume(eventsDb(Array(40).fill(300)), THREAD, 10)).toEqual({ replay: true });
  });

  it("replays exactly the event budget", async () => {
    const db = eventsDb(Array(maxEvents + 1).fill(10));
    expect(await planResume(db, THREAD, 0)).toEqual({ replay: true });
  });

  it("takes a snapshot instead when more events than the budget were missed", async () => {
    const db = eventsDb(Array(maxEvents + 2).fill(10));
    expect(await planResume(db, THREAD, 0)).toEqual({ replay: false, head: maxEvents + 1 });
  });

  it("takes a snapshot instead when a few events are too large to replay", async () => {
    const db = eventsDb([100, maxBytes, 100]);
    expect(await planResume(db, THREAD, -1)).toEqual({ replay: false, head: 2 });
  });

  it("replays from the head with nothing missed", async () => {
    expect(await planResume(eventsDb(Array(5).fill(1)), THREAD, 4)).toEqual({ replay: true });
  });
});
