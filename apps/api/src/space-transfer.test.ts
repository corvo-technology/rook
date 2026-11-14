import type { AgentHomeStore } from "@corvo/adapter-kit";
import type { Actor, Bot, SpaceExport } from "@corvo/contracts";
import { SpaceExportSchema } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AgentImportServices } from "./agent-import.js";
import { importSpace } from "./space-transfer.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@example.test",
  isDeploymentOwner: false,
};

function setup(options: { taken?: string[]; badCron?: string; writeFails?: boolean } = {}) {
  const routineRows: Record<string, unknown>[] = [];
  const memoryRows: Record<string, unknown>[] = [];
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
  };
  const prisma = {
    bot: {
      findMany: async () => (options.taken ?? []).map((name) => ({ name })),
      findUnique: async () => ({ computer: { homeKey: "home-1" } }),
    },
    memoryDocument: { findMany: async () => [] },
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
