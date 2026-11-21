import { AGENT_CATALOG, CHIEF_STARTER_ROUTINES } from "@corvo/core";
import { describe, expect, it, vi } from "vitest";
import {
  createStarterRoutines,
  enqueueRoutineAnnouncement,
  starterRoutinesPrompt,
} from "./starter-routines.js";

const entry = AGENT_CATALOG.find((agent) => agent.slug === "payments-watcher")!;

function fixture(over: { timezone?: string | null; existing?: string[] } = {}) {
  const rows: Record<string, unknown>[] = (over.existing ?? []).map((name) => ({
    id: `old-${name}`,
    name,
    threadId: "t-1",
  }));
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ timezone: over.timezone ?? null })) },
    routine: {
      findMany: vi.fn(async () => rows),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.push({ id: `r-${rows.length}`, threadId: data.threadId, name: data.name });
        return { id: `r-${rows.length}`, ...data };
      }),
    },
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const events = { append: vi.fn(async () => undefined) };
  return { prisma, jobs, events, deps: { prisma, jobs, events } as never };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  entry,
  locale: "pt-BR" as const,
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "t-1" as string | null,
  botName: "Monitor de pagamentos",
  ...overrides,
});

describe("createStarterRoutines", () => {
  it("creates the agent's routines in the person's timezone, owned by the agent", async () => {
    const f = fixture({ timezone: "America/Sao_Paulo" });
    const made = await createStarterRoutines(f.deps, input());
    expect(made).toHaveLength(entry.routines!.length);
    expect(f.prisma.routine.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: "bot-1",
        threadId: "t-1",
        name: entry.routines![0]!.name["pt-BR"],
        prompt: entry.routines![0]!.prompt["pt-BR"],
        crons: [entry.routines![0]!.cron],
        timezone: "America/Sao_Paulo",
        active: true,
      }),
    });
    expect(made[0]).toMatchObject({ timezone: "America/Sao_Paulo", timezoneKnown: true });
    expect(f.jobs.enqueue).toHaveBeenCalledTimes(entry.routines!.length);
  });

  it("falls back to UTC and says the timezone is not known", async () => {
    const f = fixture({ timezone: null });
    const made = await createStarterRoutines(f.deps, input({ locale: "en" }));
    expect(made[0]).toMatchObject({ timezone: "UTC", timezoneKnown: false });
    expect(starterRoutinesPrompt(made)).toContain("UTC");
    expect(starterRoutinesPrompt(made)).toContain("timezone");
  });

  it("makes nothing twice: an active routine with the same name is left alone", async () => {
    const f = fixture({ existing: [entry.routines![0]!.name.en] });
    const made = await createStarterRoutines(f.deps, input({ locale: "en" }));
    expect(made).toEqual([]);
    expect(f.prisma.routine.create).not.toHaveBeenCalled();
  });

  it("makes nothing for an agent without routines or without a chat", async () => {
    const f = fixture();
    const plain = AGENT_CATALOG.find((agent) => agent.slug === "translator")!;
    expect(await createStarterRoutines(f.deps, input({ entry: plain }))).toEqual([]);
    expect(await createStarterRoutines(f.deps, input({ threadId: null }))).toEqual([]);
    expect(f.prisma.routine.create).not.toHaveBeenCalled();
  });
});

describe("Rook's starter routines", () => {
  const rook = { slug: "chief", routines: CHIEF_STARTER_ROUTINES };

  it("makes the four routines active, in the owner's timezone, on their schedule", async () => {
    const f = fixture({ timezone: "America/Sao_Paulo" });
    const made = await createStarterRoutines(f.deps, input({ entry: rook, locale: "en" }));
    expect(made.map((routine) => routine.name)).toEqual([
      "Weekly plan",
      "Daily brief",
      "Board review",
      "Weekly wrap-up",
    ]);
    const created = (
      f.prisma.routine.create.mock.calls as unknown as { data: Record<string, unknown> }[][]
    ).map(([call]) => call!.data);
    expect(created.map((data) => data.crons)).toEqual([
      ["0 8 * * 1"],
      ["0 8 * * 2-5"],
      ["0 14 * * 3"],
      ["0 17 * * 5"],
    ]);
    for (const data of created) {
      expect(data).toMatchObject({ active: true, timezone: "America/Sao_Paulo", botId: "bot-1" });
    }
  });

  it("writes the names in Portuguese for a Portuguese owner", async () => {
    const f = fixture({ timezone: "America/Sao_Paulo" });
    const made = await createStarterRoutines(f.deps, input({ entry: rook }));
    expect(made.map((routine) => routine.name)).toEqual([
      "Plano da semana",
      "Resumo do dia",
      "Revisão do quadro",
      "Fechamento da semana",
    ]);
  });
});

describe("enqueueRoutineAnnouncement", () => {
  it("queues one hidden turn in the agent's own chat", async () => {
    const task = { create: vi.fn(async () => ({ id: "task-1" })) };
    const run = { create: vi.fn(async () => ({ id: "run-1" })) };
    const prisma = {
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ task, run }),
    };
    const jobs = { enqueue: vi.fn(async () => undefined) };
    await enqueueRoutineAnnouncement(
      { prisma, jobs } as never,
      { spaceId: "space-1", userId: "user-1" },
      { id: "bot-1", threadId: "t-1" },
      "say what you set up",
    );
    expect(task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: "bot-1",
        threadId: "t-1",
        prompt: "say what you set up",
      }),
    });
    expect(run.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ trigger: "created", taskId: "task-1" }),
      select: { id: true },
    });
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });
});
