import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntime, BackgroundJob } from "@corvo/adapter-kit";
import {
  createDb,
  createThreadEvents,
  readWikiPage,
  runAsSystem,
  runAsTenant,
  setWikiSettings,
  writeWikiPage,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { curateWiki, wikiCurateJobAfterTurn } from "./wiki-curator-run.js";

const postgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

const LONG =
  "We reviewed the lobby renovation with the whole team and decided to go with Alpha Builders as the contractor. The contract is signed and work starts on the twelfth of next month.";

postgres("the wiki curator (PostgreSQL)", () => {
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const id = `curator-${randomUUID()}`;
  const ids = { userId: `${id}-user`, spaceId: `${id}-space`, orgId: `${id}-org` };
  const scope = { spaceId: ids.spaceId, userId: ids.userId };
  const fixture = <T>(fn: () => Promise<T>) => runAsSystem("test fixture", fn);
  const tenant = <T>(fn: () => Promise<T>) =>
    runAsTenant({ spaceId: ids.spaceId, userId: ids.userId }, fn);
  let botId = "";

  beforeAll(() =>
    fixture(async () => {
      await prisma.user.create({
        data: { id: ids.userId, name: "Curator", email: `${id}@corvo.test` },
      });
      await prisma.organization.create({
        data: { id: ids.orgId, name: "Curator", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id: ids.spaceId, organizationId: ids.orgId, name: "x" },
      });
      const bot = await prisma.bot.create({
        data: { spaceId: ids.spaceId, userId: ids.userId, name: "Leo", color: "ink" },
      });
      botId = bot.id;
    }),
  );
  afterAll(async () => {
    await fixture(async () => {
      await prisma.organization.deleteMany({ where: { id: ids.orgId } });
      await prisma.user.deleteMany({ where: { id: ids.userId } });
    });
    await prisma.$disconnect();
    await pool.end();
  });

  /** A channel, a chat with one agent or an outsider's conversation, with the lines said in it. */
  async function conversation(
    kind: "channel" | "agent",
    lines: string[],
    extra: { wikiCapture?: boolean; cursor?: number } = {},
  ) {
    return fixture(async () => {
      const owner =
        kind === "channel"
          ? {
              groupId: (
                await prisma.chatGroup.create({
                  data: { spaceId: ids.spaceId, userId: ids.userId, name: `Eng ${randomUUID()}` },
                })
              ).id,
            }
          : {
              botId: (
                await prisma.bot.create({
                  data: {
                    spaceId: ids.spaceId,
                    userId: ids.userId,
                    name: `Solo ${randomUUID()}`,
                    color: "ink",
                  },
                })
              ).id,
            };
      const thread = await prisma.thread.create({
        data: {
          spaceId: ids.spaceId,
          userId: ids.userId,
          nextMessageSeq: lines.length,
          wikiCapture: extra.wikiCapture,
          wikiCuratedUpToSeq: extra.cursor,
          ...owner,
        },
      });
      for (const [seq, text] of lines.entries())
        await prisma.message.create({
          data: {
            threadId: thread.id,
            seq,
            role: seq % 2 === 0 ? "user" : "bot",
            botId: seq % 2 === 0 ? undefined : botId,
            blocks: [{ kind: "text", text }],
          },
        });
      return thread;
    });
  }
  const cursorOf = (threadId: string) =>
    fixture(
      async () =>
        (await prisma.thread.findUniqueOrThrow({ where: { id: threadId } })).wikiCuratedUpToSeq,
    );
  const changes = () =>
    fixture(() => prisma.wikiChange.findMany({ where: { spaceId: ids.spaceId } }));

  const proposal = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      worth: true,
      reason: "A contractor was chosen",
      source_title: "Lobby renovation",
      changes: [
        {
          op: "create",
          page: "Alpha Builders",
          kind: "Client",
          body: "Chosen for the lobby.",
          lasting: true,
        },
      ],
      ...extra,
    });

  function deps(answer: string | Error, model: unknown = { provider: "test", id: "fast-1" }) {
    const requests: AgentRunRequest[] = [];
    const runtime = {
      describe: () => ({
        capabilities: { streaming: false, compaction: true, tools: false, scripted: false },
      }),
      async *run(request: AgentRunRequest) {
        requests.push(request);
        if (answer instanceof Error) throw answer;
        yield { type: "done", text: answer };
      },
    } as unknown as AgentRuntime;
    return {
      requests,
      value: {
        prisma,
        runtime,
        events: createThreadEvents(prisma),
        resolveFastModel: vi.fn(async () => model as never),
      },
    };
  }
  const curate = (d: ReturnType<typeof deps>, threadId: string, messageId?: string) =>
    tenant(() => curateWiki(d.value, { threadId, ...(messageId ? { messageId } : {}) }));

  it("keeps what lasts from a settled channel: a source, a change, a card, and a moved cursor", async () => {
    const thread = await conversation("channel", [LONG, "Great, noted.", "Thanks everyone."]);
    const d = deps(proposal());
    await curate(d, thread.id);

    const [change] = await changes();
    expect(change?.state).toBe("applied");
    expect(await tenant(() => readWikiPage(prisma, scope, "Alpha Builders"))).toMatchObject({
      title: "Alpha Builders",
    });
    const source = await fixture(() =>
      prisma.wikiSource.findUniqueOrThrow({ where: { id: change!.sourceId } }),
    );
    expect(source).toMatchObject({
      origin: "conversation",
      title: "Lobby renovation",
      fromSeq: 0,
      toSeq: 2,
    });
    expect(source.text).toContain("decided to go with Alpha Builders");
    expect(await cursorOf(thread.id)).toBe(2);

    const card = await fixture(() =>
      prisma.message.findFirst({ where: { threadId: thread.id, seq: 3 } }),
    );
    expect(card?.blocks).toEqual([
      {
        kind: "wiki_change",
        changeId: change!.id,
        pages: [{ title: "Alpha Builders", op: "create" }],
      },
    ]);

    const [request] = d.requests;
    expect(request?.tools).toEqual([]);
    expect(request?.usageOperationKind).toBe("wiki");
    expect(request?.prompt).toContain("decided to go with Alpha Builders");
    expect(request?.prompt).toContain("Leo: Great, noted.");
  });

  it("reads nothing when too little was said, and keeps those lines for the next read", async () => {
    const thread = await conversation("channel", ["Ok", "Fine", "Sure"]);
    const d = deps(proposal());
    await curate(d, thread.id);
    expect(d.requests).toHaveLength(0);
    expect(await cursorOf(thread.id)).toBeNull();
  });

  it("reads short lines together with what is said after them, so a short fact is not lost", async () => {
    const thread = await conversation("channel", ["Start moved to Nov 25.", "Noted.", "Ok"]);
    await curate(deps(proposal()), thread.id);
    await fixture(async () => {
      await prisma.message.create({
        data: { threadId: thread.id, seq: 3, role: "user", blocks: [{ kind: "text", text: LONG }] },
      });
      await prisma.thread.update({ where: { id: thread.id }, data: { nextMessageSeq: 4 } });
    });
    const d = deps(proposal({ worth: false }));
    await curate(d, thread.id);
    expect(d.requests[0]?.prompt).toContain("Start moved to Nov 25.");
    expect(await cursorOf(thread.id)).toBe(3);
  });

  it("starts after the cursor, so what it read before is never read twice", async () => {
    const thread = await conversation("channel", [LONG, `${LONG} More.`], { cursor: 0 });
    const d = deps(proposal({ worth: false }));
    await curate(d, thread.id);
    expect(d.requests[0]?.prompt).not.toContain(
      "decided to go with Alpha Builders as the contractor. The contract is signed and work starts on the twelfth of next month.\nLeo",
    );
    expect(await cursorOf(thread.id)).toBe(1);
  });

  it("writes nothing and keeps the cursor when the model's answer is not JSON, so the job tries again", async () => {
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const before = (await changes()).length;
    await expect(curate(deps("I could not decide."), thread.id)).rejects.toThrow();
    expect(await cursorOf(thread.id)).toBeNull();
    expect((await changes()).length).toBe(before);
  });

  it("does nothing, quietly, when no fast model is ready", async () => {
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const d = deps(proposal(), null);
    await expect(curate(d, thread.id)).resolves.toBeUndefined();
    expect(d.requests).toHaveLength(0);
    expect(await cursorOf(thread.id)).toBeNull();
  });

  it("moves on without keeping anything when the stretch is not worth it", async () => {
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const before = (await changes()).length;
    await curate(deps(proposal({ worth: false })), thread.id);
    expect(await cursorOf(thread.id)).toBe(2);
    expect((await changes()).length).toBe(before);
  });

  it("keeps a secret out of what the model reads and out of what is stored", async () => {
    const text = `${LONG} Use the key api_key=sk_live_ABCDEF1234567890 for the vendor portal.`;
    const thread = await conversation("channel", [text, "ok", "ok"]);
    const d = deps(
      proposal({
        changes: [{ op: "create", page: "Vendor Portal", body: "Has a portal.", lasting: true }],
      }),
    );
    await curate(d, thread.id);
    expect(d.requests[0]?.prompt).not.toContain("sk_live_ABCDEF1234567890");
    const sources = await fixture(() =>
      prisma.wikiSource.findMany({ where: { threadId: thread.id } }),
    );
    expect(sources[0]?.text).not.toContain("sk_live_ABCDEF1234567890");
  });

  it("never reads a chat with one agent unless asked, nor an outsider's conversation at all", async () => {
    const agent = await conversation("agent", [LONG, "ok", "ok"]);
    const d = deps(proposal());
    await curate(d, agent.id);
    expect(d.requests).toHaveLength(0);

    const switchedOn = await conversation("agent", [LONG, "ok", "ok"], { wikiCapture: true });
    await curate(deps(proposal({ worth: false })), switchedOn.id);
    expect(await cursorOf(switchedOn.id)).toBe(2);
  });

  it("does not read anything while the Space has the curator off", async () => {
    await fixture(() => setWikiSettings(prisma, ids.spaceId, { capture: false }));
    try {
      const thread = await conversation("channel", [LONG, "ok", "ok"]);
      const d = deps(proposal());
      await curate(d, thread.id);
      expect(d.requests).toHaveLength(0);
    } finally {
      await fixture(() => setWikiSettings(prisma, ids.spaceId, { capture: true }));
    }
  });

  it("keeps one message on purpose, even in a chat with one agent, and leaves the cursor alone", async () => {
    const thread = await conversation("agent", ["Short note: the vendor is Acme.", "ok", "ok"]);
    const message = await fixture(() =>
      prisma.message.findFirstOrThrow({ where: { threadId: thread.id, seq: 0 } }),
    );
    const d = deps(
      proposal({ changes: [{ op: "create", page: "Acme", body: "The vendor.", lasting: true }] }),
    );
    await curate(d, thread.id, message.id);
    expect(d.requests[0]?.prompt).toContain("Short note: the vendor is Acme.");
    expect(d.requests[0]?.prompt).not.toContain("Leo: ok");
    const source = await fixture(() =>
      prisma.wikiSource.findFirstOrThrow({ where: { threadId: thread.id, messageId: message.id } }),
    );
    expect(source.origin).toBe("message");
    expect(await cursorOf(thread.id)).toBeNull();
  });

  it("holds an edit for approval by default, and says so on the card", async () => {
    await tenant(() =>
      writeWikiPage(prisma, scope, { title: "Lobby Plan", body: "Status: planning." }),
    );
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const d = deps(
      proposal({
        changes: [
          { op: "replace", page: "Lobby Plan", old: "planning", new: "building", lasting: true },
        ],
      }),
    );
    await curate(d, thread.id);
    expect((await tenant(() => readWikiPage(prisma, scope, "Lobby Plan")))?.body).toBe(
      "Status: planning.",
    );
    const [latest] = await fixture(() =>
      prisma.wikiChange.findMany({ where: { spaceId: ids.spaceId, anchorThreadId: thread.id } }),
    );
    expect(latest?.state).toBe("pending");
  });

  it("puts the quiet read after replies, and none for a conversation it does not read", async () => {
    const channel = await conversation("channel", [LONG]);
    const agent = await conversation("agent", [LONG]);
    const now = new Date("2026-11-04T12:00:00.000Z");
    const jobFor = (thread: { id: string }) =>
      tenant(async () => {
        const row = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
        return wikiCurateJobAfterTurn(prisma, row, now);
      }) as Promise<BackgroundJob | undefined>;
    expect(await jobFor(channel)).toMatchObject({
      name: "wiki.curate",
      payload: { threadId: channel.id },
      availableAt: new Date(now.getTime() + 20_000),
    });
    expect(await jobFor(agent)).toBeUndefined();
    // What outsiders say in a messaging conversation is never read, whatever its switch says.
    const outsiders = await tenant(async () => ({
      ...(await prisma.thread.findUniqueOrThrow({ where: { id: channel.id } })),
      groupId: null,
      externalConversationId: "conversation-1",
      wikiCapture: true,
    }));
    expect(await tenant(() => wikiCurateJobAfterTurn(prisma, outsiders, now))).toBeUndefined();
  });

  /** Adds a second member to the Space for the length of one test, and takes them out again. */
  async function withAnotherMember<T>(work: () => Promise<T>) {
    const other = `${id}-other`;
    await fixture(async () => {
      await prisma.user.create({
        data: { id: other, name: "Other", email: `${other}@corvo.test` },
      });
      for (const userId of [ids.userId, other]) {
        await prisma.member.create({
          data: {
            id: `${id}-org-member-${userId}`,
            organizationId: ids.orgId,
            userId,
            role: "owner",
            createdAt: new Date(),
          },
        });
        await prisma.spaceMember.create({
          data: {
            id: `${id}-member-${userId}`,
            spaceId: ids.spaceId,
            organizationId: ids.orgId,
            userId,
            role: "member",
            createdAt: new Date(),
          },
        });
      }
    });
    try {
      return await work();
    } finally {
      await fixture(async () => {
        await prisma.spaceMember.deleteMany({ where: { spaceId: ids.spaceId } });
        await prisma.member.deleteMany({ where: { organizationId: ids.orgId } });
        await prisma.user.deleteMany({ where: { id: other } });
      });
    }
  }

  it("does not read a channel by default once the Space has other people, but reads one switched on", async () => {
    await withAnotherMember(async () => {
      const channel = await conversation("channel", [LONG, "ok", "ok"]);
      const d = deps(proposal());
      await curate(d, channel.id);
      expect(d.requests).toHaveLength(0);
      const switchedOn = await conversation("channel", [LONG, "ok", "ok"], { wikiCapture: true });
      const on = deps(proposal({ worth: false }));
      await curate(on, switchedOn.id);
      expect(on.requests).toHaveLength(1);
      const row = await fixture(() =>
        prisma.thread.findUniqueOrThrow({ where: { id: channel.id } }),
      );
      const now = new Date("2026-11-04T12:00:00.000Z");
      expect(await tenant(() => wikiCurateJobAfterTurn(prisma, row, now))).toBeUndefined();
    });
  });

  it("records what the curator's model cost, as its own kind of spend", async () => {
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const callId = `wiki-usage-${randomUUID()}`;
    const d = deps(proposal({ worth: false }));
    const run = d.value.runtime.run.bind(d.value.runtime);
    d.value.runtime.run = async function* (request, context) {
      yield {
        type: "usage",
        provider: "test",
        model: "fast-1",
        callId,
        inputTokens: 120,
        outputTokens: 30,
      } as never;
      yield* run(request, context);
    };
    await curate(d, thread.id);
    const rows = await fixture(() => prisma.usageRecord.findMany({ where: { callId } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      operationKind: "wiki",
      spaceId: ids.spaceId,
      userId: ids.userId,
      inputTokens: 120,
    });
  });

  it("tells the model a message was kept on purpose", async () => {
    const thread = await conversation("agent", ["Short note: the vendor is Acme.", "ok", "ok"]);
    const message = await fixture(() =>
      prisma.message.findFirstOrThrow({ where: { threadId: thread.id, seq: 0 } }),
    );
    const d = deps(proposal({ worth: false }));
    await curate(d, thread.id, message.id);
    expect(d.requests[0]?.prompt).toMatch(/asked to keep/i);
    const quiet = await conversation("channel", [LONG, "ok", "ok"]);
    const q = deps(proposal({ worth: false }));
    await curate(q, quiet.id);
    expect(q.requests[0]?.prompt).not.toMatch(/asked to keep/i);
  });

  it("queues the weekly review after a read, only once a week has passed since the last", async () => {
    const enqueue = vi.fn(async () => undefined);
    const jobs = { enqueue, cancel: vi.fn(), close: vi.fn() };
    const thread = await conversation("channel", [LONG, "ok", "ok"]);
    const d = deps(proposal({ worth: false }));
    await tenant(() => curateWiki({ ...d.value, jobs }, { threadId: thread.id }));
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: "wiki.review", payload: scope }),
    );

    await fixture(() =>
      prisma.wikiSettings.upsert({
        where: { spaceId: ids.spaceId },
        create: { spaceId: ids.spaceId, reviewedAt: new Date() },
        update: { reviewedAt: new Date() },
      }),
    );
    enqueue.mockClear();
    const next = await conversation("channel", [LONG, "ok", "ok"]);
    await tenant(() => curateWiki({ ...d.value, jobs }, { threadId: next.id }));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
