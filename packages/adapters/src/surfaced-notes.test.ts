import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "./run-context.js";
import { taskTools } from "./run-tools-tasks.js";
import { noteBackgroundPost } from "./run-turn.js";

function ledger() {
  const rows: Array<Record<string, any>> = [];
  const prisma = {
    surfacedItem: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        rows.push(create);
      }),
      count: vi.fn(
        async ({ where }: { where: { runId: string } }) =>
          rows.filter((row) => row.runId === where.runId).length,
      ),
    },
  };
  return { prisma, rows };
}

describe("note_surfaced", () => {
  const run = (prisma: unknown) =>
    ({
      deps: { prisma },
      run: { id: "r1", spaceId: "s1" },
      bot: { id: "chief" },
      thread: { id: "t1" },
    }) as unknown as RunContext;
  const call = (args: Record<string, unknown>) =>
    ({ args, finish: (result: unknown) => result }) as never;

  it("writes what the agent declares, keyed to this bot, chat and run", async () => {
    const { prisma, rows } = ledger();
    const result = await taskTools.note_surfaced!(
      run(prisma),
      call({ key: "calendar:conflict:2026-11-23", version: "9:00", summary: "Meeting overlap" }),
    );
    expect(result).toEqual({ ok: true, key: "calendar:conflict:2026-11-23" });
    expect(rows[0]).toMatchObject({
      botId: "chief",
      threadId: "t1",
      spaceId: "s1",
      runId: "r1",
      fingerprint: "9:00",
    });
  });

  it("answers with an error when the key is missing", async () => {
    const { prisma } = ledger();
    expect(await taskTools.note_surfaced!(run(prisma), call({ summary: "x" }))).toHaveProperty(
      "error",
    );
  });
});

describe("noteBackgroundPost", () => {
  it("records a background post under its run when the agent declared nothing", async () => {
    const { prisma, rows } = ledger();
    await noteBackgroundPost(prisma as never, { id: "r1", spaceId: "s1" }, "chief", "t1", "Hi");
    expect(rows).toEqual([expect.objectContaining({ key: "run:r1", summary: "Hi", runId: "r1" })]);
  });

  it("adds nothing on top of items the agent already declared", async () => {
    const { prisma, rows } = ledger();
    rows.push({ runId: "r1", key: "declared" });
    await noteBackgroundPost(prisma as never, { id: "r1", spaceId: "s1" }, "chief", "t1", "Hi");
    expect(rows).toHaveLength(1);
  });
});
