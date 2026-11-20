import { randomUUID } from "node:crypto";
import type { MessageBlock } from "@corvo/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { BranchError, forkThreadBranch, switchThreadBranch } from "./index.js";
import { createThreadMessage, loadRunHistoryMessages } from "./messages.js";
import { provisionMessagingIdentity } from "./messaging.js";
import { asSystem, runAsSystem, runAsTenant } from "./row-security.js";
import {
  messageVariantsByMessage,
  threadBranchInclude,
  visibleMessagesWhere,
} from "./thread-branches.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("thread branches (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let spaceId = "";
  let userId = "";
  let botId = "";
  let threadId = "";

  beforeAll(() => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
  });
  beforeEach(async () => {
    const identity = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "test", address: `branches-${randomUUID()}` },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    ({ spaceId, userId, botId, threadId } = identity);
  });
  afterEach(async () => {
    await system.messagingIdentity.deleteMany({ where: { userId } });
    await system.organization.deleteMany({ where: { id: spaceId } });
    await system.user.deleteMany({ where: { id: userId } });
  });
  afterAll(async () => {
    await close?.();
  });

  const tenant = <T>(fn: () => Promise<T>) => runAsTenant({ spaceId, userId }, fn);
  const text = (value: string): MessageBlock[] => [{ kind: "text", text: value }];
  const say = (role: "user" | "bot", value: string, runId?: string) =>
    tenant(() =>
      createThreadMessage(prisma, {
        threadId,
        role,
        blocks: text(value),
        botId: role === "bot" ? botId : undefined,
        runId,
      }),
    );
  const fork = (forkSeq: number) =>
    tenant(() =>
      prisma.$transaction((tx) => forkThreadBranch(tx, { spaceId, threadId, botId, forkSeq })),
    );
  const switchTo = (branchId: string | null) =>
    tenant(() =>
      prisma.$transaction((tx) => switchThreadBranch(tx, { spaceId, threadId, botId, branchId })),
    );
  const onScreen = () =>
    tenant(async () => {
      const visible = await visibleMessagesWhere(prisma, threadId);
      const rows = await prisma.message.findMany({
        where: { threadId, AND: [visible] },
        orderBy: { seq: "asc" },
        select: { blocks: true },
      });
      return rows.map((row) => (row.blocks as { text: string }[])[0]?.text);
    });
  const variantsOf = (messageId: string) =>
    tenant(async () => (await messageVariantsByMessage(prisma, threadId)).get(messageId));

  it("keeps the earlier reply reachable when a reply is regenerated", async () => {
    const question = await say("user", "question");
    const first = await say("bot", "first answer");
    await fork(question.seq);
    const second = await say("bot", "second answer");

    expect(await onScreen()).toEqual(["question", "second answer"]);
    expect(await variantsOf(second.id)).toEqual({
      index: 1,
      count: 2,
      branchIds: [null, second.branchId],
    });

    await switchTo(null);
    expect(await onScreen()).toEqual(["question", "first answer"]);
    expect(await variantsOf(first.id)).toMatchObject({ index: 0, count: 2 });
  });

  it("branches from an edited message and leaves the original conversation whole", async () => {
    await say("user", "one");
    await say("bot", "reply one");
    const two = await say("user", "two");
    await say("bot", "reply two");
    await fork(two.seq - 1);
    const edited = await say("user", "two, edited");
    await say("bot", "reply to edited");

    expect(await onScreen()).toEqual(["one", "reply one", "two, edited", "reply to edited"]);
    expect(await variantsOf(edited.id)).toMatchObject({ index: 1, count: 2 });

    await switchTo(null);
    expect(await onScreen()).toEqual(["one", "reply one", "two", "reply two"]);
    expect(await variantsOf(two.id)).toMatchObject({ index: 0, count: 2 });
  });

  it("counts every version of the same point, however many times it was redone", async () => {
    const question = await say("user", "question");
    await say("bot", "a");
    await fork(question.seq);
    await say("bot", "b");
    await fork(question.seq);
    const third = await say("bot", "c");

    expect(await onScreen()).toEqual(["question", "c"]);
    const variants = await variantsOf(third.id);
    expect(variants).toMatchObject({ index: 2, count: 3 });
    expect(variants?.branchIds).toHaveLength(3);
  });

  it("nests a branch made on a branch", async () => {
    const one = await say("user", "one");
    await say("bot", "reply one");
    await fork(one.seq);
    await say("bot", "reply one, again");
    const two = await say("user", "two");
    await say("bot", "reply two");
    await fork(two.seq);
    await say("bot", "reply two, again");

    expect(await onScreen()).toEqual(["one", "reply one, again", "two", "reply two, again"]);
    await switchTo(null);
    expect(await onScreen()).toEqual(["one", "reply one"]);
  });

  it("gives the agent only the version on screen", async () => {
    const question = await say("user", "question");
    await say("bot", "abandoned");
    await fork(question.seq);
    await say("bot", "kept");
    const run = { id: randomUUID(), threadId };
    const history = await tenant(async () => {
      const thread = await prisma.thread.findUniqueOrThrow({
        where: { id: threadId },
        include: threadBranchInclude,
      });
      return loadRunHistoryMessages(prisma, run, 50, thread);
    });
    expect(history.map((row) => (row.blocks as { text: string }[])[0]?.text).sort()).toEqual([
      "kept",
      "question",
    ]);
  });

  it("reports earlier actions only when one touched something outside the chat", async () => {
    const question = await say("user", "question");
    const task = await system.task.create({
      data: { spaceId, botId, threadId, userId, prompt: "question", status: "completed" },
    });
    const run = await system.run.create({
      data: {
        spaceId,
        botId,
        threadId,
        taskId: task.id,
        userId,
        status: "completed",
        trigger: "user",
      },
    });
    await say("bot", "sent the email", run.id);
    await system.externalEffect.create({
      data: {
        spaceId,
        runId: run.id,
        kind: "send_email",
        idempotencyKey: randomUUID(),
        status: "intended",
        request: {},
      },
    });
    expect((await fork(question.seq)).abandonedHadEffects).toBe(false);

    await switchTo(null);
    await system.externalEffect.updateMany({
      where: { runId: run.id },
      data: { status: "completed" },
    });
    expect((await fork(question.seq)).abandonedHadEffects).toBe(true);
  });

  it("refuses to branch from a message a summary already swallowed", async () => {
    await say("user", "old");
    const recent = await say("user", "recent");
    await system.thread.update({
      where: { id: threadId },
      data: { historyCompactedUpToSeq: recent.seq, historyCompactionSummary: "summary" },
    });
    await expect(fork(recent.seq - 1)).rejects.toBeInstanceOf(BranchError);
    await expect(fork(recent.seq)).resolves.toBeDefined();
  });

  it("drops the summary of a version that leaves the screen", async () => {
    const question = await say("user", "question");
    await fork(question.seq);
    await system.thread.update({
      where: { id: threadId },
      data: { historyCompactedUpToSeq: question.seq, historyCompactionSummary: "summary" },
    });
    await switchTo(null);
    const thread = await system.thread.findUniqueOrThrow({ where: { id: threadId } });
    expect(thread.historyCompactionSummary).toBeNull();
    expect(thread.historyCompactedUpToSeq).toBeNull();
  });

  it("does not reach a branch of another thread", async () => {
    await expect(switchTo("not-a-branch")).rejects.toMatchObject({ code: "not_found" });
  });
});
