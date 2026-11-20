import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import type { AppendEventInput } from "./events.js";
import { appendEventInTransaction } from "./events.js";
import { asSystem } from "./row-security.js";

const dbTests =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

dbTests("action evidence", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `action-org-${suffix}`;
  const spaceId = `action-space-${suffix}`;
  const userId = `action-user-${suffix}`;
  const runUserId = `action-run-user-${suffix}`;
  const botId = `action-bot-${suffix}`;
  const computerId = `action-computer-${suffix}`;
  let db: ReturnType<typeof createDb>;
  let prisma: PrismaClient;
  let threadId: string;

  const event = (type: string, payload: Record<string, unknown>, runId?: string) =>
    prisma.$transaction((tx) =>
      appendEventInTransaction(tx, {
        spaceId,
        threadId,
        botId,
        type: type as AppendEventInput["type"],
        payload,
        runId,
      }),
    );
  const evidence = () =>
    prisma.actionEvidence.findMany({ where: { spaceId }, orderBy: { occurredAt: "asc" } });

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = asSystem(db.prisma, "action evidence test");
    for (const id of [userId, runUserId])
      await prisma.user.create({
        data: { id, name: "x", email: `${id}@corvo.test`, emailVerified: false },
      });
    await prisma.organization.create({
      data: { id: organizationId, name: "Actions", slug: organizationId, createdAt: new Date() },
    });
    await prisma.space.create({
      data: { id: spaceId, organizationId, name: "General", isDefault: true },
    });
    await prisma.computer.create({
      data: {
        id: computerId,
        spaceId,
        userId,
        scopeKey: computerId,
        homeKey: computerId,
        kind: "fake",
      },
    });
    await prisma.bot.create({
      data: { id: botId, spaceId, userId, name: "Ana", color: "x", computerId },
    });
    threadId = (await prisma.thread.create({ data: { spaceId, userId } })).id;
  });
  afterAll(async () => {
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("copies commands and tool calls when they are recorded, never their output", async () => {
    await event("computer.command", {
      executionId: "e1",
      kind: "shell",
      command: "ls -la",
      cwd: "/home",
      status: "done",
      exitCode: 2,
      output: "secret output",
    });
    await event("agent.tool.called", { name: "web_search", executionId: "e2" });
    await event("agent.tool.completed", {
      name: "web_search",
      executionId: "e2",
      durationMs: 5,
      outcome: "error",
      error: "boom with detail",
    });
    await event("message.created", { text: "not an action" });

    const rows = await evidence();
    expect(rows.map((r) => [r.kind, r.executionId, r.detail, r.status, r.exitCode])).toEqual([
      ["command", "e1", "ls -la", "done", 2],
      ["tool_called", "e2", "web_search", null, null],
      ["tool_completed", "e2", "web_search", "error", null],
    ]);
    expect(rows[0]).toMatchObject({ organizationId, botId, computerId, userId, cwd: "/home" });
    expect(JSON.stringify(rows)).not.toContain("secret output");
    expect(JSON.stringify(rows)).not.toContain("boom with detail");
  });

  it("names the member whose run it was, not only the thread's owner", async () => {
    const task = await prisma.task.create({
      data: { spaceId, botId, threadId, userId: runUserId, prompt: "p", status: "running" },
    });
    const run = await prisma.run.create({
      data: {
        spaceId,
        botId,
        threadId,
        taskId: task.id,
        userId: runUserId,
        status: "running",
        trigger: "user",
      },
    });
    await event("agent.tool.called", { name: "read_file", executionId: "e3" }, run.id);
    const row = (await evidence()).find((r) => r.executionId === "e3");
    expect(row).toMatchObject({ userId: runUserId, runId: run.id });
  });

  it("survives the deletion of the space, user and organization, and refuses edits", async () => {
    const before = (await evidence()).length;
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, runUserId] } } });
    expect(await evidence()).toHaveLength(before);
    await expect(
      prisma.actionEvidence.updateMany({ where: { spaceId }, data: { detail: "x" } }),
    ).rejects.toThrow();
  });
});
