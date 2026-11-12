import type { AgentRunRequest, AgentRuntime, BackgroundJob } from "@corvo/adapter-kit";
import { wikiCurateJob } from "@corvo/adapter-kit";
import {
  buildCuratorPrompt,
  CURATOR_RULES,
  type CuratorProposal,
  type CuratorThreadKind,
  curatesThread,
  curatorSystemPrompt,
  parseCuratorOutput,
  parseWikiPage,
} from "@corvo/core";
import type { PrismaClient, ThreadEvents } from "@corvo/db";
import {
  advanceWikiCursor,
  appendEventInTransaction,
  createThreadMessageInTransaction,
  createWikiChange,
  getWikiSettings,
  listWikiChanges,
  listWikiPages,
  readWikiPage,
  recordUsage,
  searchWiki,
  withTransactionRetry,
} from "@corvo/db";
import { getLogger, redactSensitiveText } from "@corvo/logging";
import { summarizeTimeoutMs } from "./history-compaction.js";
import { formatWikiIndex } from "./wiki-context.js";

export const WIKI_CURATE_MIN_CHARS = 160;
export const WIKI_CURATE_MAX_MESSAGES = 14;
const INDEX_BYTES = 4 * 1024;
const RELATED_PAGES = 3;
const RELATED_PAGE_CHARS = 3_000;
const RELATED_WORDS = 6;
const FAILED_TEXT = /^(?:I hit a problem:|Unknown model )/i;

export type WikiCuratorDeps = {
  prisma: PrismaClient;
  runtime: AgentRuntime;
  events: ThreadEvents;
  resolveFastModel?: (scope: {
    userId: string;
    spaceId: string;
  }) => Promise<AgentRunRequest["model"] | undefined>;
};

export type CuratorThreadFacts = {
  id: string;
  spaceId: string;
  groupId: string | null;
  botId: string | null;
  externalConversationId: string | null;
  wikiCapture: boolean | null;
};

/** A channel is a group's, a chat with one agent is a bot's, and anything else came from outside. */
function kindOf(thread: CuratorThreadFacts): CuratorThreadKind {
  if (thread.groupId) return "channel";
  if (thread.botId) return "agent";
  return "external";
}

/** A channel is one person's, and what the curator learns is read by everyone in the Space. */
async function hasOtherMembers(prisma: PrismaClient, spaceId: string): Promise<boolean> {
  return (await prisma.spaceMember.count({ where: { spaceId } })) > 1;
}

/** Whether the curator reads this conversation now: its own switch, else the default for its kind. */
export async function threadIsCurated(
  prisma: PrismaClient,
  thread: CuratorThreadFacts,
): Promise<boolean> {
  const settings = await getWikiSettings(prisma, thread.spaceId);
  return curatesThread({
    kind: kindOf(thread),
    threadCapture: thread.wikiCapture,
    settingsCapture: settings.capture,
    sharedSpace: await hasOtherMembers(prisma, thread.spaceId),
  });
}

/**
 * The quiet read to queue after a reply, or nothing when the curator does not read this
 * conversation (a chat with one agent unless asked, anything an outsider said, or the Space has it off).
 */
export async function wikiCurateJobAfterTurn(
  prisma: PrismaClient,
  thread: CuratorThreadFacts,
  now: Date = new Date(),
): Promise<BackgroundJob | undefined> {
  return (await threadIsCurated(prisma, thread)) ? wikiCurateJob(thread.id, { now }) : undefined;
}

const proseOf = (blocks: unknown): string =>
  (Array.isArray(blocks) ? blocks : [])
    .flatMap((block) =>
      block?.kind === "text" && typeof block.text === "string" ? [block.text as string] : [],
    )
    .join("\n")
    .trim();

/** The words a stretch is about: long ones, once each, for finding pages that may be related. */
function wordsOf(text: string): string[] {
  const seen = new Set<string>();
  for (const word of text.toLowerCase().match(/\p{L}{5,}/gu) ?? []) seen.add(word);
  return [...seen].slice(0, RELATED_WORDS);
}

/** Pages that may be related to a text: a few of those that match its longer words. */
export async function relatedWikiPages(
  prisma: PrismaClient,
  scope: { spaceId: string; userId: string },
  text: string,
): Promise<{ title: string; body: string }[]> {
  const related: { title: string; body: string }[] = [];
  for (const word of wordsOf(text)) {
    for (const hit of await searchWiki(prisma, scope, word, 2)) {
      if (related.length >= RELATED_PAGES) break;
      if (related.some((page) => page.title === hit.title)) continue;
      const page = await readWikiPage(prisma, scope, hit.title);
      if (page)
        related.push({
          title: page.title,
          body: parseWikiPage(page.body).body.slice(0, RELATED_PAGE_CHARS),
        });
    }
  }
  return related;
}

/**
 * One call to the curator's model, its usage recorded as its own kind. Throws when the answer is
 * not a usable proposal, so a caller that keeps a cursor leaves it where it was.
 */
export async function askCurator(
  deps: Pick<WikiCuratorDeps, "prisma" | "runtime">,
  input: {
    scope: { spaceId: string; userId: string };
    model: NonNullable<AgentRunRequest["model"]>;
    botId: string;
    threadId: string;
    runId: string;
    operationId: string;
    /** The agent whose usage this is, when there is one. */
    usageBotId?: string;
    prompt: string;
    instructions: string;
  },
): Promise<CuratorProposal> {
  const { prisma } = deps;
  const usageOf = (event: Parameters<typeof recordUsage>[1]) =>
    recordUsage(prisma, event, {
      spaceId: input.scope.spaceId,
      userId: input.scope.userId,
      botId: input.usageBotId,
      operationId: input.operationId,
      operationKind: "wiki",
    });
  let answer = "";
  let failed = false;
  for await (const event of deps.runtime.run(
    {
      botId: input.botId,
      threadId: input.threadId,
      runId: input.runId,
      usageOperationKind: "wiki",
      onUsage: async (event) => {
        await usageOf(event);
      },
      prompt: input.prompt,
      instructions: input.instructions,
      history: [],
      tools: [],
      model: input.model,
      allowSilentEmpty: true,
    },
    {
      operationId: input.operationId,
      traceId: input.operationId,
      spaceId: input.scope.spaceId,
      userId: input.scope.userId,
      signal: AbortSignal.timeout(summarizeTimeoutMs(input.prompt.length)),
    },
  )) {
    if (event.type === "usage" && !event.accounted) await usageOf(event);
    if (event.type === "text" && FAILED_TEXT.test(event.text.trim())) failed = true;
    if (event.type === "done" && event.text) {
      answer = event.text.trim();
      if (FAILED_TEXT.test(answer)) failed = true;
    }
  }
  const proposal = failed ? null : parseCuratorOutput(answer);
  if (!proposal) throw new Error("The wiki curator's model did not answer with a usable proposal.");
  return proposal;
}

/**
 * Reads a conversation (or one message kept on purpose) and keeps what lasts as a change to the
 * wiki. Nothing is written and the cursor stays put when the model fails or answers with something
 * that is not JSON, so the job runs again; a stretch that is not worth keeping still moves the cursor.
 */
export async function curateWiki(
  deps: WikiCuratorDeps,
  payload: { threadId: string; messageId?: string },
): Promise<void> {
  const { prisma } = deps;
  const thread = await prisma.thread.findUnique({
    where: { id: payload.threadId },
    select: {
      id: true,
      spaceId: true,
      userId: true,
      groupId: true,
      botId: true,
      externalConversationId: true,
      wikiCapture: true,
      wikiCuratedUpToSeq: true,
    },
  });
  if (!thread) return;
  const kind = kindOf(thread);
  // What outsiders say in a messaging conversation is never read, kept on purpose or not.
  if (kind === "external") return;
  const kept = Boolean(payload.messageId);
  if (!kept && !(await threadIsCurated(prisma, thread))) return;
  const settings = await getWikiSettings(prisma, thread.spaceId);

  const scope = { spaceId: thread.spaceId, userId: thread.userId };
  const model = await deps.resolveFastModel?.(scope);
  if (!model || model.provider === "scripted") {
    getLogger().info(`wiki curator skipped for thread ${thread.id}: no fast model is ready`);
    return;
  }

  const rows = await prisma.message.findMany({
    where: kept
      ? { id: payload.messageId, threadId: thread.id }
      : {
          threadId: thread.id,
          seq: { gt: thread.wikiCuratedUpToSeq ?? -1 },
          role: { in: ["user", "bot"] },
        },
    orderBy: { seq: kept ? "asc" : "desc" },
    take: kept ? 1 : WIKI_CURATE_MAX_MESSAGES,
    select: { seq: true, role: true, botId: true, blocks: true },
  });
  if (!rows.length) return;
  rows.sort((a, b) => a.seq - b.seq);
  const fromSeq = rows[0]!.seq;
  const toSeq = rows.at(-1)!.seq;

  const botNames = new Map(
    (
      await prisma.bot.findMany({
        where: { id: { in: rows.flatMap((row) => (row.botId ? [row.botId] : [])) } },
        select: { id: true, name: true },
      })
    ).map((bot) => [bot.id, bot.name]),
  );
  const lines = rows.flatMap((row) => {
    const text = redactSensitiveText(proseOf(row.blocks));
    if (!text) return [];
    const author = row.role === "user" ? "User" : (botNames.get(row.botId ?? "") ?? "Agent");
    return [{ author, text }];
  });
  const said = lines.reduce((total, line) => total + line.text.length, 0);
  // Too little to be worth a model call: the lines stay unread, so the next read has them too.
  if (!kept && said < WIKI_CURATE_MIN_CHARS) return;
  if (!lines.length) return;

  const transcript = lines.map((line) => `${line.author}: ${line.text}`).join("\n");
  const related = await relatedWikiPages(prisma, scope, transcript);
  const [pages, waiting, rules] = await Promise.all([
    listWikiPages(prisma, scope),
    listWikiChanges(prisma, scope, { state: ["pending"] }),
    readWikiPage(prisma, scope, "Wiki rules"),
  ]);
  const prompt = buildCuratorPrompt({
    index: formatWikiIndex(pages, INDEX_BYTES),
    related,
    pending: waiting.flatMap((change) =>
      change.pages.map((page) => `[[${page.title}]] ${page.op}`),
    ),
    messages: lines,
    kept,
  });
  const proposal = await askCurator(deps, {
    scope,
    model,
    botId: thread.botId ?? "wiki-curator",
    usageBotId: thread.botId ?? undefined,
    threadId: thread.id,
    runId: `wiki:${thread.id}:${fromSeq}:${toSeq}`,
    operationId: `wiki:${thread.id}`,
    prompt,
    instructions: curatorSystemPrompt(
      rules ? parseWikiPage(rules.body).body.trim() || CURATOR_RULES : CURATOR_RULES,
    ),
  });

  const change =
    proposal.worth && proposal.ops.length
      ? await createWikiChange(prisma, scope, {
          source: {
            origin: kept ? "message" : "conversation",
            title: proposal.sourceTitle,
            text: transcript,
            threadId: thread.id,
            ...(kept ? { messageId: payload.messageId } : { fromSeq, toSeq }),
          },
          ops: proposal.ops,
          reason: proposal.reason,
          anchor: { threadId: thread.id, ...(kept ? { messageId: payload.messageId } : {}) },
          edits: settings.edits,
        })
      : null;
  if (!kept) await advanceWikiCursor(prisma, thread.id, thread.wikiCuratedUpToSeq, toSeq);
  if (change)
    await postWikiChangeCard(
      deps,
      thread,
      change,
      rows.find((row) => row.botId)?.botId ?? undefined,
    );
}

/**
 * The line in the conversation that shows what was kept; a failure here never loses the change.
 * Every event names a bot; a channel has none of its own, so it borrows the one that spoke in it.
 */
export async function postWikiChangeCard(
  deps: Pick<WikiCuratorDeps, "prisma" | "events">,
  thread: CuratorThreadFacts,
  change: { id: string; pages: { title: string; op: "create" | "append" | "replace" }[] },
  speakingBotId?: string,
): Promise<void> {
  try {
    const botId =
      thread.botId ??
      speakingBotId ??
      (
        await deps.prisma.chatGroupMember.findFirst({
          where: { groupId: thread.groupId ?? "" },
          select: { botId: true },
        })
      )?.botId;
    if (!botId) return;
    const blocks = [{ kind: "wiki_change" as const, changeId: change.id, pages: change.pages }];
    const seq = await withTransactionRetry(() =>
      deps.prisma.$transaction(async (tx) => {
        const message = await createThreadMessageInTransaction(tx, {
          threadId: thread.id,
          role: "system",
          blocks,
        });
        const event = await appendEventInTransaction(tx, {
          spaceId: thread.spaceId,
          threadId: thread.id,
          botId,
          type: "thread.message.created",
          payload: { messageId: message.id, role: "system", blocks },
        });
        return event.seq;
      }),
    );
    await deps.events.notify(thread.id, seq).catch((error) => {
      getLogger().error("wiki change card realtime notification", error);
    });
  } catch (error) {
    getLogger().error("wiki change card", error);
  }
}
