import { randomUUID } from "node:crypto";
import type { AgentRunRequest, AgentRuntime } from "@corvo/adapter-kit";
import {
  addUserMemory,
  createDb,
  createThreadEvents,
  decideUserMemory,
  listUserMemories,
  proposeUserMemory,
  runAsSystem,
  runAsTenant,
  setMemoryLearning,
} from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { botDisabledTools } from "./memory-mode.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { memoryTools } from "./run-tools-memory.js";
import {
  learnUserMemories,
  loadUserMemoryContext,
  memoryLearnJobAfterTurn,
} from "./user-memory-run.js";

const postgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL ? describe : describe.skip;

const SAID =
  "I run a small bakery in Lisbon and I always want answers in Portuguese, short and without bullet points.";

postgres("what an agent knows about the person (PostgreSQL)", () => {
  const { prisma, pool } = createDb(process.env.DATABASE_URL!);
  const id = `you-${randomUUID()}`;
  const ids = { userId: `${id}-user`, spaceId: `${id}-space`, orgId: `${id}-org` };
  const scope = { spaceId: ids.spaceId, userId: ids.userId };
  const fixture = <T>(fn: () => Promise<T>) => runAsSystem("test fixture", fn);
  const tenant = <T>(fn: () => Promise<T>) => runAsTenant(scope, fn);

  beforeAll(() =>
    fixture(async () => {
      await prisma.user.create({
        data: { id: ids.userId, name: "You", email: `${id}@corvo.test` },
      });
      await prisma.organization.create({
        data: { id: ids.orgId, name: "You", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id: ids.spaceId, organizationId: ids.orgId, name: "x" },
      });
      await prisma.member.create({
        data: {
          id: `${id}-member`,
          organizationId: ids.orgId,
          userId: ids.userId,
          role: "owner",
          createdAt: new Date(),
        },
      });
      await prisma.spaceMember.create({
        data: {
          id: `${id}-sm`,
          spaceId: ids.spaceId,
          organizationId: ids.orgId,
          userId: ids.userId,
          createdAt: new Date(),
        },
      });
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

  async function chat(mode: string | null = null, lines: string[] = []) {
    return fixture(async () => {
      const bot = await prisma.bot.create({
        data: {
          spaceId: ids.spaceId,
          userId: ids.userId,
          name: `Leo ${randomUUID()}`,
          color: "ink",
          memoryMode: mode,
        },
      });
      const thread = await prisma.thread.create({
        data: {
          spaceId: ids.spaceId,
          userId: ids.userId,
          botId: bot.id,
          nextMessageSeq: lines.length,
        },
      });
      for (const [seq, text] of lines.entries())
        await prisma.message.create({
          data: {
            threadId: thread.id,
            seq,
            role: seq % 2 === 0 ? "user" : "bot",
            botId: seq % 2 === 0 ? undefined : bot.id,
            blocks: [{ kind: "text", text }],
          },
        });
      return { bot, thread };
    });
  }

  const remember = async (
    fact: unknown,
    held: Awaited<ReturnType<typeof chat>>,
  ): Promise<unknown> => {
    const ctx = {
      deps: { prisma, events: createThreadEvents(prisma) },
      bot: held.bot,
      thread: held.thread,
      run: { spaceId: ids.spaceId, userId: ids.userId },
    } as unknown as RunContext;
    const call = { args: { fact }, finish: (value: unknown) => value } as unknown as ToolCall;
    return tenant(() => memoryTools.remember_about_user!(ctx, call));
  };
  const lastCard = (threadId: string) =>
    fixture(
      async () =>
        (await prisma.message.findFirst({ where: { threadId }, orderBy: { seq: "desc" } }))?.blocks,
    );

  it("asks first by default: a card, and nothing is known until Save", async () => {
    const held = await chat();
    expect(await remember("Runs a bakery in Lisbon", held)).toEqual({
      ok: true,
      status: "waiting for the person to save it",
    });
    const [memory] = await tenant(() => listUserMemories(prisma, scope, { state: ["pending"] }));
    expect(memory).toMatchObject({ text: "Runs a bakery in Lisbon", source: "agent" });
    expect(await lastCard(held.thread.id)).toEqual([
      { kind: "memory_fact", memoryId: memory!.id, text: "Runs a bakery in Lisbon" },
    ]);
    expect(await tenant(() => loadUserMemoryContext(prisma, scope))).toBeUndefined();

    await tenant(() => decideUserMemory(prisma, scope, memory!.id, "save"));
    expect(await tenant(() => loadUserMemoryContext(prisma, scope))).toContain(
      "- Runs a bakery in Lisbon",
    );
  });

  it("saves alone when the agent is set to, and the card is there to undo it", async () => {
    const held = await chat("auto");
    expect(await remember("Wakes up at five", held)).toEqual({ ok: true, status: "kept" });
    const [memory] = await tenant(() => listUserMemories(prisma, scope, { state: ["saved"] }));
    const saved = (await tenant(() => listUserMemories(prisma, scope))).find(
      (entry) => entry.text === "Wakes up at five",
    );
    expect(saved?.state).toBe("saved");
    expect(memory).toBeDefined();
    expect(await lastCard(held.thread.id)).toEqual([
      { kind: "memory_fact", memoryId: saved!.id, text: "Wakes up at five" },
    ]);
    await tenant(() => decideUserMemory(prisma, scope, saved!.id, "forget"));
    expect(await tenant(() => loadUserMemoryContext(prisma, scope))).not.toContain(
      "Wakes up at five",
    );
  });

  it("only reads when set to: it cannot add, and the tool is not even offered", async () => {
    const held = await chat("read");
    expect(await remember("Owns a boat", held)).toEqual({
      error: "You may use what is known about the person, but you may not add to it.",
    });
    expect(botDisabledTools(held.bot)).toContain("remember_about_user");
    expect(botDisabledTools({ memoryMode: "auto", disabledBuiltinTools: ["shell"] })).toEqual([
      "shell",
    ]);
    const known = await tenant(() => listUserMemories(prisma, scope));
    expect(known.some((entry) => entry.text === "Owns a boat")).toBe(false);
  });

  it("does not keep what the person forgot, and says so to the agent", async () => {
    const held = await chat("auto");
    const first = await tenant(() =>
      proposeUserMemory(prisma, scope, {
        text: "Hates mondays",
        source: "agent",
        state: "pending",
      }),
    );
    if (first.outcome !== "created") throw new Error("expected a suggestion");
    await tenant(() => decideUserMemory(prisma, scope, first.memory.id, "discard"));
    expect(await remember("hates Mondays", held)).toMatchObject({ ok: true, status: "not kept" });
    expect(await lastCard(held.thread.id)).toBeUndefined();
  });

  it("refuses a fact that is not one short line", async () => {
    const held = await chat();
    expect(await remember("x".repeat(500), held)).toEqual({
      error: "fact must be one short sentence about the person.",
    });
  });

  it("tells the prompt how many older facts did not fit, and they stay findable", async () => {
    for (let index = 0; index < 5; index += 1)
      await tenant(() =>
        addUserMemory(prisma, scope, `Budget fact number ${index} ${"y".repeat(40)}`),
      );
    const text = await tenant(() => loadUserMemoryContext(prisma, scope, 150));
    expect(text).toMatch(/older facts? (is|are) not shown; look for them with recall_about_user/);
    expect(text).toContain("<about_the_person>");
  });

  describe("learning from what the person says", () => {
    const fact = (text: string) => ({ text, about_person: true, lasting: true });
    function deps(answer: string | Error) {
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
          resolveFastModel: vi.fn(async () => ({ provider: "test", id: "fast-1" }) as never),
        },
      };
    }
    const cursor = (threadId: string) =>
      fixture(
        async () =>
          (await prisma.thread.findUniqueOrThrow({ where: { id: threadId } })).memoryLearnedUpToSeq,
      );
    const learn = (d: ReturnType<typeof deps>, threadId: string) =>
      tenant(() => learnUserMemories(d.value, { threadId }));

    it("does nothing until the person turns it on", async () => {
      const held = await chat(null, [SAID, "Understood.", "Thanks!"]);
      const d = deps(JSON.stringify({ facts: [fact("Runs a bakery")] }));
      await learn(d, held.thread.id);
      expect(d.requests).toHaveLength(0);
      expect(await tenant(() => memoryLearnJobAfterTurn(prisma, held.thread))).toBeUndefined();
      await tenant(() => setMemoryLearning(prisma, scope, true));
      expect(await tenant(() => memoryLearnJobAfterTurn(prisma, held.thread))).toMatchObject({
        name: "memory.learn",
      });
    });

    it("suggests from the person's words only, as pending, and moves the cursor", async () => {
      await tenant(() => setMemoryLearning(prisma, scope, true));
      const held = await chat(null, [
        SAID,
        "I assume you also love sourdough, so I will mention sourdough every time.",
        "And I am vegetarian, which matters for every recipe you give me.",
      ]);
      const d = deps(
        JSON.stringify({
          facts: [
            fact("Runs a small bakery in Lisbon"),
            { text: "Wants this report today", about_person: true, lasting: false },
          ],
        }),
      );
      await learn(d, held.thread.id);
      const [request] = d.requests;
      expect(request?.usageOperationKind).toBe("memory");
      expect(request?.tools).toEqual([]);
      expect(request?.prompt).toContain("small bakery in Lisbon");
      expect(request?.prompt).toContain("vegetarian");
      // What the agent assumed never reaches the model.
      expect(request?.prompt).not.toContain("sourdough");
      const pending = await tenant(() => listUserMemories(prisma, scope, { state: ["pending"] }));
      expect(pending.map((entry) => [entry.text, entry.source])).toContainEqual([
        "Runs a small bakery in Lisbon",
        "learned",
      ]);
      expect(pending.some((entry) => entry.text.includes("report"))).toBe(false);
      expect(await cursor(held.thread.id)).toBe(2);
    });

    it("does not suggest again what the person already discarded", async () => {
      const held = await chat(null, [SAID, "ok", "I never eat meat, not even fish or chicken."]);
      const first = await tenant(() =>
        proposeUserMemory(prisma, scope, {
          text: "Never eats meat",
          source: "learned",
          state: "pending",
        }),
      );
      if (first.outcome !== "created") throw new Error("expected a suggestion");
      await tenant(() => decideUserMemory(prisma, scope, first.memory.id, "discard"));
      await learn(deps(JSON.stringify({ facts: [fact("never eats meat")] })), held.thread.id);
      const all = await tenant(() => listUserMemories(prisma, scope));
      expect(all.filter((entry) => entry.text.toLowerCase() === "never eats meat")).toEqual([
        expect.objectContaining({ state: "forgotten" }),
      ]);
    });

    it("keeps the cursor and fails the job when the model answers badly, so it is tried again", async () => {
      const held = await chat(null, [SAID, "ok", "More about me that is long enough to be read."]);
      await expect(learn(deps("this is not json"), held.thread.id)).rejects.toThrow(
        /usable suggestions/,
      );
      expect(await cursor(held.thread.id)).toBeNull();
    });

    it("reads nothing when too little was said, or when the agent only reads", async () => {
      const short = await chat(null, ["Ok", "Fine", "Sure"]);
      const d = deps(JSON.stringify({ facts: [] }));
      await learn(d, short.thread.id);
      const reader = await chat("read", [SAID, "ok", SAID]);
      await learn(d, reader.thread.id);
      expect(d.requests).toHaveLength(0);
    });
  });
});
