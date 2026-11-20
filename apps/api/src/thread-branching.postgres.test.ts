import { randomUUID } from "node:crypto";
import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import {
  asSystem,
  createDb,
  createRepos,
  createThreadMessage,
  provisionMessagingIdentity,
  runAsSystem,
  runAsTenant,
} from "@corvo/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH_EFFECTS_NOTICE,
  beginEdit,
  regenerateThreadReply,
  switchThreadVersion,
} from "./thread-branching.js";
import { forkConversation } from "./thread-fork.js";
import { loadMessagePage } from "./thread-message-pages.js";
import type { ThreadTarget } from "./thread-target.js";
import { sendThreadMessage } from "./thread-target.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(databaseUrl);

describe.skipIf(!enabled)("edit, regenerate and branch (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let actor: Actor;
  let botId: string;
  let threadId: string;
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  const events = { notify } as never;
  const jobs = { enqueue } as never;

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
    vi.clearAllMocks();
    const identity = await runAsSystem("test fixture", () =>
      provisionMessagingIdentity(
        prisma,
        { provider: "test", address: `branching-${randomUUID()}` },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    ({ botId, threadId } = identity);
    actor = { spaceId: identity.spaceId, userId: identity.userId } as Actor;
    await system.run.updateMany({
      where: { threadId, status: { in: ["queued", "running", "leased"] } },
      data: { status: "cancelled" },
    });
  });
  afterEach(async () => {
    await system.messagingIdentity.deleteMany({ where: { userId: actor.userId } });
    await system.organization.deleteMany({ where: { id: actor.spaceId } });
    await system.user.deleteMany({ where: { id: actor.userId } });
  });
  afterAll(async () => {
    await close?.();
  });

  const target = () => ({ kind: "bot", botId, threadId, bot: { computer: null } }) as ThreadTarget;
  const tenant = <T>(fn: () => Promise<T>) => runAsTenant(actor, fn);
  const send = (text: string, edit?: { messageId: string }) =>
    tenant(() =>
      sendThreadMessage({ prisma, events, jobs }, actor, target(), {
        text,
        clientNonce: randomUUID(),
        ...(edit ? { edit } : {}),
      }),
    );
  /** What a finished turn leaves: the run done and the agent's reply written. */
  async function reply(runId: string, answer: string, effect?: "intended" | "completed") {
    await system.run.update({ where: { id: runId }, data: { status: "completed" } });
    const message = await tenant(() =>
      createThreadMessage(prisma, {
        threadId,
        role: "bot",
        botId,
        runId,
        blocks: [{ kind: "text", text: answer }],
      }),
    );
    if (effect) {
      await system.externalEffect.create({
        data: {
          spaceId: actor.spaceId,
          runId,
          kind: "send_email",
          idempotencyKey: randomUUID(),
          status: effect,
          request: {},
        },
      });
    }
    return message;
  }
  const page = () =>
    tenant(async () => {
      const result = await loadMessagePage(prisma, threadId, undefined, 100);
      return result.messages.map((message) => ({
        text: (message.blocks[0] as { text?: string }).text,
        variants: message.variants,
      }));
    });
  const texts = async () => (await page()).map((message) => message.text);

  async function startedConversation(effect?: "intended" | "completed") {
    const sent = await send("write the email");
    const message = await reply(sent.runId!, "Dear Ana, ...", effect);
    return { sent, message };
  }

  it("regenerates the last reply as a new run and keeps the first one reachable", async () => {
    const { sent, message } = await startedConversation();
    const result = await tenant(() =>
      regenerateThreadReply({ prisma, events, jobs }, actor, target(), {}),
    );

    expect(result.runId).not.toBe(sent.runId);
    const run = await system.run.findUniqueOrThrow({ where: { id: result.runId } });
    const original = await system.run.findUniqueOrThrow({ where: { id: sent.runId! } });
    expect(run.sourceMessageId).toBe(original.sourceMessageId);
    expect(run.status).toBe("queued");
    expect(enqueue).toHaveBeenCalled();
    // The new reply has not been written yet; the person's message stands alone.
    expect(await texts()).toEqual(["write the email"]);

    await reply(result.runId, "Hi Ana, ...");
    const shown = await page();
    expect(shown.map((entry) => entry.text)).toEqual(["write the email", "Hi Ana, ..."]);
    expect(shown[1]?.variants).toMatchObject({ index: 1, count: 2 });

    await tenant(() => switchThreadVersion({ prisma, events }, actor, target(), null));
    const back = await page();
    expect(back.map((entry) => entry.text)).toEqual(["write the email", "Dear Ana, ..."]);
    expect(back[1]).toMatchObject({ variants: { index: 0, count: 2 } });
    expect(message.branchId).toBeNull();
  });

  it("edits a message into a new version and leaves the original reachable", async () => {
    const { sent } = await startedConversation();
    const first = await system.message.findFirstOrThrow({
      where: { threadId, role: "user" },
    });
    const edited = await send("write it shorter", { messageId: first.id });

    expect(edited.runId).not.toBe(sent.runId);
    expect(await texts()).toEqual(["write it shorter"]);
    const editedMessage = (await page())[0];
    expect(editedMessage?.variants).toMatchObject({ index: 1, count: 2 });
    const run = await system.run.findUniqueOrThrow({ where: { id: edited.runId! } });
    expect(run.sourceMessageId).toBeTruthy();
    expect(run.sourceMessageId).not.toBe(first.id);

    await reply(edited.runId!, "Short version.");
    await tenant(() => switchThreadVersion({ prisma, events }, actor, target(), null));
    expect(await texts()).toEqual(["write the email", "Dear Ana, ..."]);
  });

  it("states it on the new version when the abandoned reply took an action", async () => {
    await startedConversation("completed");
    const result = await tenant(() =>
      regenerateThreadReply({ prisma, events, jobs }, actor, target(), {}),
    );
    await reply(result.runId, "Hi Ana, ...");
    const rows = await system.message.findMany({ where: { threadId, role: "system" } });
    expect(rows.map((row) => (row.blocks as { text: string }[])[0]?.text)).toEqual([
      BRANCH_EFFECTS_NOTICE,
    ]);
    // It belongs to the new version only.
    await tenant(() => switchThreadVersion({ prisma, events }, actor, target(), null));
    expect(await texts()).toEqual(["write the email", "Dear Ana, ..."]);
  });

  it("states nothing when the abandoned reply took no action", async () => {
    await startedConversation();
    await tenant(() => regenerateThreadReply({ prisma, events, jobs }, actor, target(), {}));
    expect(await system.message.count({ where: { threadId, role: "system" } })).toBe(0);
  });

  it("does not edit or regenerate while a reply is being written", async () => {
    const sent = await send("write the email");
    const first = await system.message.findFirstOrThrow({ where: { threadId, role: "user" } });
    await expect(
      tenant(() => regenerateThreadReply({ prisma, events, jobs }, actor, target(), {})),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(send("changed my mind", { messageId: first.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      tenant(() => switchThreadVersion({ prisma, events }, actor, target(), null)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await system.threadBranch.count({ where: { threadId } })).toBe(0);
    expect(sent.runId).toBeTruthy();
  });

  it("lets only the author or the thread owner edit a message", async () => {
    await startedConversation();
    const first = await system.message.findFirstOrThrow({ where: { threadId, role: "user" } });
    const stranger = { spaceId: actor.spaceId, userId: randomUUID() } as Actor;
    await expect(
      tenant(() => prisma.$transaction((tx) => beginEdit(tx, stranger, target(), first.id))),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await system.threadBranch.count({ where: { threadId } })).toBe(0);

    // A member's own message is theirs to edit; the owner of the thread may edit it too.
    const member = randomUUID();
    await system.message.update({ where: { id: first.id }, data: { authorUserId: member } });
    await expect(
      tenant(() =>
        prisma.$transaction((tx) =>
          beginEdit(tx, { ...stranger, userId: member } as Actor, target(), first.id),
        ),
      ),
    ).resolves.toBeDefined();
  });

  it("does not edit the agent's messages", async () => {
    const { message } = await startedConversation();
    await expect(
      tenant(() => prisma.$transaction((tx) => beginEdit(tx, actor, target(), message.id))),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("continues in a new chat with the conversation up to the message", async () => {
    await startedConversation();
    const second = await send("now make it shorter");
    const shorter = await reply(second.runId!, "Dear Ana.");
    await send("and add a greeting");
    const repos = createRepos(prisma);
    const forked = await tenant(() =>
      forkConversation({ prisma, jobs }, repos, actor, { threadId, botId }, shorter.id),
    );

    expect(forked.botId).not.toBe(botId);
    const copy = await system.thread.findUniqueOrThrow({ where: { botId: forked.botId } });
    const rows = await system.message.findMany({
      where: { threadId: copy.id },
      orderBy: { seq: "asc" },
    });
    expect(rows.map((row) => [row.role, (row.blocks as { text: string }[])[0]?.text])).toEqual([
      ["user", "write the email"],
      ["bot", "Dear Ana, ..."],
      ["user", "now make it shorter"],
      ["bot", "Dear Ana."],
    ]);
    expect(rows.every((row) => row.runId === null)).toBe(true);
    // The chat it came from is untouched, and a short copy needs no summary.
    expect(await system.message.count({ where: { threadId } })).toBe(5);
    expect(enqueue).not.toHaveBeenCalledWith(expect.objectContaining({ task: "history_compact" }));
  });

  it("summarizes the older part of a long copy", async () => {
    let last = "";
    for (let index = 0; index < 20; index++) {
      const sent = await send(`message ${index}`);
      last = (await reply(sent.runId!, `answer ${index}`)).id;
    }
    enqueue.mockClear();
    await tenant(() =>
      forkConversation({ prisma, jobs }, createRepos(prisma), actor, { threadId, botId }, last),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
