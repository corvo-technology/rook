import type { AgentHomeStore } from "@corvo/adapter-kit";
import type { Actor, Bot, SpaceExport } from "@corvo/contracts";
import { SpaceExportSchema } from "@corvo/contracts";
import { userMemoryFingerprint } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import type { AgentImportServices } from "./agent-import.js";
import { exportSpace, importSpace } from "./space-transfer.js";

const actorScope = { spaceId: "space-1", userId: "user-1" };

const wiki = vi.hoisted(() => ({
  writeWikiPage: vi.fn(async (_db: unknown, _scope: unknown, _page: unknown) => ({})),
  proposeUserMemory: vi.fn(async (_db: unknown, _scope: unknown, _fact: unknown) => ({
    outcome: "created" as const,
  })),
  setWikiSettings: vi.fn(async (_db: unknown, _space: string, _settings: unknown) => ({})),
  createGroup: vi.fn(async (_actor: unknown, _input: unknown) => ({ id: "group-new" })),
}));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  writeWikiPage: wiki.writeWikiPage,
  setWikiSettings: wiki.setWikiSettings,
  proposeUserMemory: wiki.proposeUserMemory,
  createGroupRepos: () => ({ createGroup: wiki.createGroup }),
}));

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.test",
  isDeploymentOwner: false,
};

function setup(
  options: {
    taken?: string[];
    badCron?: string;
    writeFails?: boolean;
    wikiSlugs?: string[];
    knownFacts?: string[];
    channelNames?: string[];
    boardTickets?: number;
  } = {},
) {
  const routineRows: Record<string, unknown>[] = [];
  const memoryRows: Record<string, unknown>[] = [];
  const stepRows: Record<string, unknown>[] = [];
  const ticketRows: Record<string, unknown>[] = [];
  const sectionUpdates: Record<string, unknown>[] = [];
  const tx = {
    memoryDocument: {
      findFirst: async () => ({ id: "index-doc" }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({
        id: "index-doc",
        revision: 2,
        ...data,
      }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        memoryRows.push(data);
        return { id: `doc-${memoryRows.length}`, revision: 1, ...data };
      },
    },
    memoryRevision: { create: async () => ({}) },
    routine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        routineRows.push(data);
        return { id: `routine-${routineRows.length}`, ...data };
      },
    },
    routineStep: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        stepRows.push(...data);
      },
    },
    board: {
      create: async () => ({ id: "board-1" }),
      update: async () => ({ id: "board-1" }),
    },
    ticket: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        ticketRows.push(data);
      },
    },
    botSection: {
      aggregate: async () => ({ _max: { position: null } }),
      createMany: async () => ({}),
      findUniqueOrThrow: async () => ({ id: "section-1" }),
    },
    bot: {
      updateMany: async (args: Record<string, unknown>) => {
        sectionUpdates.push({ kind: "bot", ...args });
      },
    },
    chatGroup: {
      updateMany: async (args: Record<string, unknown>) => {
        sectionUpdates.push({ kind: "channel", ...args });
      },
    },
  };
  const taken = options.taken ?? [];
  const prisma = {
    bot: {
      findMany: async () => taken.map((name) => ({ id: `old-${name.toLowerCase()}`, name })),
      findUnique: async () => ({ computer: { homeKey: "home-1" } }),
    },
    memoryDocument: {
      findMany: async () => [],
      findFirst: async ({ where }: { where: { slug: string } }) =>
        options.wikiSlugs?.includes(where.slug) ? { id: "page" } : null,
    },
    wikiSettings: { findUnique: async () => null },
    userMemory: {
      findUnique: async ({ where }: { where: Record<string, { fingerprint: string }> }) =>
        options.knownFacts?.some(
          (text) =>
            userMemoryFingerprint(actorScope, text) ===
            where.spaceId_userId_fingerprint?.fingerprint,
        )
          ? { id: "fact" }
          : null,
    },
    chatGroup: {
      findMany: async () => (options.channelNames ?? []).map((name) => ({ name })),
    },
    board: {
      findUnique: async () =>
        options.boardTickets === undefined
          ? null
          : { id: "board-0", _count: { tickets: options.boardTickets } },
    },
  };
  let created = 0;
  const createBot = vi.fn(
    async (
      _actor: Actor,
      input: { name: string; seed: (t: never, id: string) => Promise<void> },
    ) => {
      created += 1;
      const id = `bot-${created}`;
      await input.seed(tx as never, id);
      return { id, threadId: `thread-${created}`, name: input.name } as Bot;
    },
  );
  const services = {
    prisma,
    createBot,
    inTransaction: async (run: (t: never) => Promise<unknown>) => run(tx as never),
    findBot: async () => null,
    assertRoutineSchedule: (input: { crons: string[] }) => {
      if (options.badCron && input.crons.includes(options.badCron)) throw new Error("bad cron");
    },
    routineNextRunAt: () => null,
    routineRowData: (_a: Actor, input: Record<string, unknown>) => ({ ...input }),
    announceRoutine: vi.fn(async () => undefined),
  } as unknown as AgentImportServices;
  const writeFile = vi.fn(async () => {
    if (options.writeFails) throw new Error("disk full");
  });
  const home = { writeFile } as unknown as AgentHomeStore;
  const create = vi.fn(async (_a: Actor, _i: { content: string }) => ({}) as never);
  return {
    services,
    deps: { prisma: prisma as never, home },
    createBot,
    writeFile,
    create,
    routineRows,
    memoryRows,
    stepRows,
    ticketRows,
    sectionUpdates,
  };
}

function file(overrides: Partial<SpaceExport> = {}): SpaceExport {
  return SpaceExportSchema.parse({
    version: 1,
    kind: "space",
    exportedAt: "2026-01-01T00:00:00.000Z",
    bots: [],
    memory: [],
    skills: [],
    ...overrides,
  });
}

const aBot = (name: string, extra: Record<string, unknown> = {}) => ({
  bot: { name, title: "", description: "", instructions: "Be kind." },
  memory: [],
  routines: [],
  files: [],
  ...extra,
});

describe("importSpace", () => {
  it("skips bots whose name is taken, ignoring case", async () => {
    const t = setup({ taken: ["ana"] });
    const result = await importSpace(
      t.services,
      t.deps,
      { create: t.create },
      actor,
      file({ bots: [aBot("Ana"), aBot("Bia"), aBot("BIA")] }),
    );
    expect(result.added).toEqual(["Bia"]);
    expect(result.existing).toEqual(["Ana", "BIA"]);
    expect(t.createBot).toHaveBeenCalledTimes(1);
  });

  it("creates routines paused and skips an invalid one without failing the bot", async () => {
    const t = setup({ badCron: "bad" });
    const result = await importSpace(
      t.services,
      t.deps,
      { create: t.create },
      actor,
      file({
        bots: [
          aBot("Ana", {
            routines: [
              { name: "ok", prompt: "Go", crons: ["0 9 * * *"], timezone: "UTC" },
              { name: "broken", prompt: "Go", crons: ["bad"], timezone: "UTC" },
            ],
          }),
        ],
      }),
    );
    expect(result.added).toEqual(["Ana"]);
    expect(result.routines).toBe(1);
    expect(t.routineRows).toHaveLength(1);
    expect(t.routineRows[0]).toMatchObject({ name: "ok", botId: "bot-1", active: false });
  });

  it("counts base64 and failed files as skipped and keeps the bot", async () => {
    const t = setup();
    const result = await importSpace(
      t.services,
      t.deps,
      { create: t.create },
      actor,
      file({
        bots: [
          aBot("Ana", {
            files: [
              { path: "notes.txt", content: "hi" },
              { path: "logo.png", content: "AAEC", encoding: "base64" },
            ],
          }),
        ],
      }),
    );
    expect(result.skippedFiles).toBe(1);
    expect(t.writeFile).toHaveBeenCalledTimes(1);

    const failing = setup({ writeFails: true });
    const failed = await importSpace(
      failing.services,
      failing.deps,
      { create: failing.create },
      actor,
      file({ bots: [aBot("Ana", { files: [{ path: "a.txt", content: "x" }] })] }),
    );
    expect(failed.added).toEqual(["Ana"]);
    expect(failed.skippedFiles).toBe(1);
  });

  it("adds space memory and counts skills, ignoring a skill that conflicts", async () => {
    const t = setup();
    t.create.mockImplementationOnce(async () => {
      throw new Error("A skill with that name already exists.");
    });
    const result = await importSpace(
      t.services,
      t.deps,
      { create: t.create },
      actor,
      file({
        memory: [{ path: "USER.md", content: "Likes tea." }],
        skills: [{ content: "---\nname: one\n---\nA" }, { content: "---\nname: two\n---\nB" }],
      }),
    );
    expect(result.skills).toBe(1);
    expect(t.create).toHaveBeenCalledTimes(2);
    expect(t.memoryRows).toEqual([
      expect.objectContaining({ path: "USER.md", scope: "user", botId: null }),
    ]);
  });
});

describe("importSpace, models of another machine", () => {
  const routine = (name: string, modelProvider: string, modelId: string) => ({
    name,
    prompt: "Go",
    crons: ["0 9 * * *"],
    timezone: "UTC",
    modelProvider,
    modelId,
  });
  const exported = file({
    bots: [
      aBot("Ana", {
        routines: [
          routine("local", "cli-engine", "claude/sonnet"),
          routine("hosted", "anthropic", "claude-sonnet"),
        ],
      }),
    ],
  });

  it("puts a routine on the space's model when this server cannot run its own", async () => {
    const t = setup();
    const result = await importSpace(
      t.services,
      t.deps,
      { create: t.create },
      actor,
      exported,
      async (provider) => provider !== "cli-engine",
    );
    expect(result.modelsReset).toBe(1);
    expect(result.routines).toBe(2);
    const byName = Object.fromEntries(t.routineRows.map((row) => [row.name, row]));
    expect(byName.local).toMatchObject({ modelProvider: null, modelId: null, active: false });
    expect(byName.hosted).toMatchObject({ modelProvider: "anthropic", modelId: "claude-sonnet" });
  });

  it("treats a model it cannot check as unusable, and keeps usable ones as they were", async () => {
    const failing = setup();
    const result = await importSpace(
      failing.services,
      failing.deps,
      { create: failing.create },
      actor,
      exported,
      async () => {
        throw new Error("lookup failed");
      },
    );
    expect(result.modelsReset).toBe(2);

    const same = setup();
    const kept = await importSpace(
      same.services,
      same.deps,
      { create: same.create },
      actor,
      exported,
    );
    expect(kept.modelsReset).toBe(0);
    expect(same.routineRows.every((row) => row.modelProvider !== null)).toBe(true);
  });
});

const run = (t: ReturnType<typeof setup>, input: SpaceExport) =>
  importSpace(t.services, t.deps, { create: t.create }, actor, input);

describe("importSpace, everything a space holds", () => {
  it("writes wiki pages and settings, skipping a title already there", async () => {
    wiki.writeWikiPage.mockClear();
    wiki.setWikiSettings.mockClear();
    const t = setup({ wikiSlugs: ["pricing"] });
    const result = await run(
      t,
      file({
        wiki: [
          { title: "Pricing", body: "Old." },
          { title: "Brand voice", body: "Warm." },
        ],
        wikiSettings: { capture: false, edits: "auto" },
      }),
    );
    expect(result.wikiPages).toBe(1);
    expect(wiki.writeWikiPage).toHaveBeenCalledTimes(1);
    expect(wiki.writeWikiPage.mock.calls[0]?.[2]).toMatchObject({
      title: "Brand voice",
      body: "Warm.",
    });
    expect(wiki.setWikiSettings).toHaveBeenCalledWith(expect.anything(), "space-1", {
      capture: false,
      edits: "auto",
    });
  });

  it("adds facts with their bot by name, skipping one the person already has", async () => {
    wiki.proposeUserMemory.mockClear();
    const t = setup({ knownFacts: ["Likes tea."] });
    const result = await run(
      t,
      file({
        bots: [aBot("Ana")],
        facts: [
          { text: "Likes  tea.", state: "saved", source: "typed" },
          { text: "Lives in Lisbon.", state: "pending", source: "learned", bot: "ANA" },
        ],
      }),
    );
    expect(result.facts).toBe(1);
    expect(wiki.proposeUserMemory).toHaveBeenCalledTimes(1);
    expect(wiki.proposeUserMemory.mock.calls[0]?.[2]).toEqual({
      text: "Lives in Lisbon.",
      source: "learned",
      state: "pending",
      botId: "bot-1",
    });
  });

  it("keeps every routine field, arrives paused, and maps steps to bots by name", async () => {
    const t = setup();
    const result = await run(
      t,
      file({
        bots: [
          aBot("Ana", {
            routines: [
              {
                name: "Watch",
                prompt: "Check",
                crons: [],
                timezone: "UTC",
                notify: false,
                modelProvider: "openai",
                modelId: "gpt-x",
                thinkingLevel: "high",
                watch: { kind: "command", command: "date", everyMinutes: 30 },
                messageProvider: "whatsapp",
                webhookEnabled: true,
                steps: [
                  { bot: "BIA", instruction: "Summarize" },
                  { bot: "Gone", instruction: "Skipped" },
                ],
              },
              { name: "Nothing", prompt: "x", crons: [], timezone: "UTC" },
            ],
          }),
          aBot("Bia"),
        ],
      }),
    );
    expect(result.routines).toBe(1);
    expect(result.skippedRoutines).toBe(1);
    expect(t.routineRows[0]).toMatchObject({
      name: "Watch",
      active: false,
      notify: false,
      modelProvider: "openai",
      modelId: "gpt-x",
      thinkingLevel: "high",
      messageProvider: "whatsapp",
      webhookEnabled: true,
      watch: { kind: "command", command: "date", everyMinutes: 30 },
    });
    expect(t.stepRows).toEqual([
      { routineId: "routine-1", botId: "bot-2", instruction: "Summarize", position: 2 },
    ]);
  });

  it("maps channel members by bot name and drops channels left with too few", async () => {
    wiki.createGroup.mockClear();
    const t = setup({ taken: ["Old"], channelNames: ["general"] });
    const result = await run(
      t,
      file({
        bots: [aBot("Ana")],
        channels: [
          { name: "Launch", purpose: "Ship it", members: ["ana", "OLD", "Gone"] },
          { name: "Solo", members: ["Ana", "Gone"] },
          { name: "General", members: ["Ana", "Old"] },
        ],
      }),
    );
    expect(result.channels).toBe(1);
    expect(wiki.createGroup).toHaveBeenCalledTimes(1);
    expect(wiki.createGroup.mock.calls[0]?.[1]).toEqual({
      name: "Launch",
      purpose: "Ship it",
      botIds: ["bot-1", "old-old"],
    });
  });

  it("imports tickets with assignees by bot name, and leaves a board that has tickets", async () => {
    const board = {
      name: "Board",
      ticketPrefix: "ACME",
      tickets: [
        {
          number: 7,
          title: "Fix it",
          status: "done",
          assignee: "ana",
          comments: [{ author: "Gone", body: "Looked" }],
        },
      ],
    };
    const fresh = setup();
    const result = await run(fresh, file({ bots: [aBot("Ana")], board }));
    expect(result.tickets).toBe(1);
    expect(fresh.ticketRows[0]).toMatchObject({
      number: 7,
      assigneeBotId: "bot-1",
      comments: { create: [{ authorBotId: null, body: "Looked" }] },
    });
    expect(fresh.ticketRows[0]?.completedAt).toBeInstanceOf(Date);

    const busy = setup({ boardTickets: 3 });
    expect((await run(busy, file({ board }))).tickets).toBe(0);
    expect(busy.ticketRows).toHaveLength(0);
  });

  it("puts only the bots and channels it added into their sections", async () => {
    const t = setup({ taken: ["Old"] });
    await run(
      t,
      file({
        bots: [aBot("Ana")],
        sections: [{ name: "Sales", bots: ["Ana", "Old"], channels: [] }],
      }),
    );
    expect(t.sectionUpdates[0]).toMatchObject({
      kind: "bot",
      where: { id: { in: ["bot-1"] } },
      data: { sectionId: "section-1" },
    });
  });

  it("still imports a version 1 file that has none of the newer fields", async () => {
    const t = setup();
    const old = SpaceExportSchema.parse({
      version: 1,
      kind: "space",
      exportedAt: "2026-01-01T00:00:00.000Z",
      bots: [
        {
          bot: { name: "Ana", title: "", description: "", instructions: "" },
          memory: [],
          routines: [{ name: "Daily", prompt: "Go", crons: ["0 9 * * *"], timezone: "UTC" }],
          files: [],
        },
      ],
      memory: [],
      skills: [],
    });
    const result = await run(t, old);
    expect(result).toMatchObject({
      added: ["Ana"],
      routines: 1,
      wikiPages: 0,
      channels: 0,
      tickets: 0,
    });
    expect(t.createBot.mock.calls[0]?.[1]).toMatchObject({ notifyOnFinish: true, starters: [] });
    expect(t.routineRows[0]).toMatchObject({ notify: true, watch: null, active: false });
  });
});

describe("exportSpace", () => {
  it("carries wiki pages, full routines, channels, the board and sections by bot name", async () => {
    const prisma = {
      routine: {
        findMany: async () => [
          {
            name: "Watch",
            prompt: "Check",
            crons: [],
            timezone: "UTC",
            notify: false,
            webhookEnabled: false,
            githubEnabled: false,
            messageProvider: null,
            modelProvider: "openai",
            modelId: "gpt-x",
            thinkingLevel: "high",
            watch: { kind: "command", command: "date", everyMinutes: 30, loud: false },
            steps: [{ instruction: "Summarize", bot: { name: "Bia" } }],
          },
        ],
      },
      memoryDocument: {
        findMany: async ({ where }: { where: { scope: string } }) =>
          where.scope === "wiki" ? [{ path: "Pricing.md", content: "Fees." }] : [],
      },
      agentSkill: { findMany: async () => [] },
      wikiSettings: { findUnique: async () => ({ capture: false, edits: "auto" }) },
      userMemory: {
        findMany: async () => [
          { text: "Likes tea.", state: "saved", source: "typed", botId: "bot-a" },
        ],
      },
      chatGroup: {
        findMany: async () => [
          {
            name: "Launch",
            purpose: null,
            sectionId: "s1",
            members: [{ botId: "bot-a" }, { botId: "bot-b" }, { botId: "stale" }],
          },
        ],
      },
      board: {
        findUnique: async () => ({
          name: "Board",
          ticketPrefix: "ACME",
          statusLabels: null,
          tickets: [
            {
              number: 3,
              title: "Fix",
              description: null,
              status: "todo",
              priority: "high",
              assigneeBotId: "bot-b",
              fields: null,
              comments: [{ authorBotId: "bot-a", body: "On it" }],
            },
          ],
        }),
      },
      botSection: { findMany: async () => [{ id: "s1", name: "Sales" }] },
    };
    const home = { exportHome: async function* () {} } as unknown as AgentHomeStore;
    const bots: Record<string, unknown> = {
      "bot-a": { name: "Ana", sectionId: "s1" },
      "bot-b": { name: "Bia", sectionId: null },
    };
    const repos = {
      listBots: async () => [{ id: "bot-a" }, { id: "bot-b" }],
      getBot: async (_a: Actor, id: string) => ({
        id,
        title: "",
        description: "",
        instructions: "",
        color: "#123456",
        notifyOnFinish: false,
        starters: ["Hi"],
        disabledBuiltinTools: [],
        computer: { homeKey: "h", scope: "team" },
        ...(bots[id] as object),
      }),
    };
    const exported = await exportSpace({ prisma: prisma as never, home }, repos as never, actor);
    expect(SpaceExportSchema.safeParse(exported).success).toBe(true);
    expect(exported.wiki).toEqual([{ title: "Pricing", body: "Fees." }]);
    expect(exported.wikiSettings).toEqual({ capture: false, edits: "auto" });
    expect(exported.facts).toEqual([
      { text: "Likes tea.", state: "saved", source: "typed", bot: "Ana" },
    ]);
    expect(exported.bots[0]?.bot).toMatchObject({
      color: "#123456",
      notifyOnFinish: false,
      starters: ["Hi"],
    });
    expect(exported.bots[0]?.routines[0]).toMatchObject({
      modelProvider: "openai",
      thinkingLevel: "high",
      watch: { kind: "command", command: "date" },
      steps: [{ bot: "Bia", instruction: "Summarize" }],
    });
    expect(exported.channels).toEqual([{ name: "Launch", purpose: null, members: ["Ana", "Bia"] }]);
    expect(exported.board?.tickets[0]).toMatchObject({ number: 3, assignee: "Bia", fields: [] });
    expect(exported.board?.tickets[0]?.comments).toEqual([{ author: "Ana", body: "On it" }]);
    expect(exported.sections).toEqual([{ name: "Sales", bots: ["Ana"], channels: ["Launch"] }]);
  });
});
