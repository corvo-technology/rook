import { randomUUID } from "node:crypto";
import type { AdapterContext, BackgroundJob, JobPublisher } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, runAsSystem } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  executeResearchStart,
  executeResearchStatus,
  MAX_RUNNING_RESEARCH_PER_BOT,
  prismaResearchStore,
  reconcileResearch,
} from "./research-service.js";

const describePostgres =
  process.env.VERIFY_DATABASE && process.env.DATABASE_URL ? describe.sequential : describe.skip;

describePostgres("research jobs (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let db: ReturnType<typeof createDb>;
  const users: string[] = [];
  beforeAll(() => {
    db = createDb(process.env.DATABASE_URL!);
    prisma = db.prisma;
  });
  afterAll(async () => {
    if (!db) return;
    await runAsSystem("test cleanup", async () => {
      await prisma.researchJob.deleteMany({ where: { userId: { in: users } } });
      await prisma.organization.deleteMany({ where: { id: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  async function setup(trigger = "user") {
    const id = randomUUID();
    users.push(id);
    const { bot, thread, run } = await runAsSystem("test fixture", async () => {
      await prisma.user.create({
        data: { id, name: "Research test", email: `${id}@example.test`, emailVerified: true },
      });
      await prisma.organization.create({
        data: { id, name: "Research test", slug: id, createdAt: new Date() },
      });
      await prisma.space.create({
        data: { id, organizationId: id, name: "Research test", isDefault: true },
      });
      await prisma.member.create({
        data: { id, organizationId: id, userId: id, role: "owner", createdAt: new Date() },
      });
      const bot = await prisma.bot.create({
        data: { spaceId: id, userId: id, name: "Research test", color: "test-color" },
      });
      const thread = await prisma.thread.create({
        data: { spaceId: id, userId: id, botId: bot.id },
      });
      const task = await prisma.task.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          prompt: "Test",
          status: "completed",
        },
      });
      const run = await prisma.run.create({
        data: {
          spaceId: id,
          userId: id,
          botId: bot.id,
          threadId: thread.id,
          taskId: task.id,
          status: "completed",
          trigger,
        },
      });
      return { bot, thread, run };
    });
    const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
    const jobs: JobPublisher = {
      enqueue,
      cancel: async () => undefined,
      close: async () => undefined,
    };
    const deps = { prisma, jobs, events: { notify: vi.fn(async () => undefined) } };
    const context = (operationId = randomUUID()): AdapterContext & { botId: string } => ({
      operationId,
      traceId: "test",
      spaceId: id,
      userId: id,
      botId: bot.id,
      signal: new AbortController().signal,
    });
    const start = (question: string, operationId?: string) =>
      runAsSystem("agent run tool call", () =>
        executeResearchStart(deps, context(operationId), run, { question }),
      );
    const store = prismaResearchStore(deps);
    const job = (researchId: string) =>
      runAsSystem("read", () =>
        prisma.researchJob.findUniqueOrThrow({ where: { id: researchId } }),
      );
    const wakes = () =>
      asSystem(prisma).run.findMany({ where: { threadId: thread.id, trigger: "research" } });
    return { id, bot, thread, deps, enqueue, context, start, store, job, wakes, run };
  }

  it("starts a job with a card, queues it once and answers a repeated call with the same job", async () => {
    const t = await setup();
    const operationId = randomUUID();
    const first = await t.start("What changed in team pricing?", operationId);
    const again = await t.start("What changed in team pricing?", operationId);
    if (!("id" in first) || !("id" in again)) throw new Error("start failed");
    expect(again.id).toBe(first.id);
    expect(t.enqueue.mock.calls.filter(([job]) => job.name === "research.run")).not.toHaveLength(0);
    const row = await t.job(first.id);
    expect(row.messageId).toBeTruthy();
    const message = await runAsSystem("read", () =>
      prisma.message.findUniqueOrThrow({ where: { id: row.messageId ?? "" } }),
    );
    expect(message.blocks).toEqual([
      { kind: "research", researchId: first.id, question: row.question, status: "running" },
    ]);
  });

  it("caps the jobs one agent runs at once", async () => {
    const t = await setup();
    for (let i = 0; i < MAX_RUNNING_RESEARCH_PER_BOT; i += 1)
      expect(await t.start(`question ${i}`)).toHaveProperty("id");
    expect(await t.start("one too many")).toHaveProperty("error");
  });

  it("keeps the ledger once per page and finishes with a card update and a wake", async () => {
    const t = await setup();
    const started = await t.start("What changed in team pricing?");
    if (!("id" in started)) throw new Error("start failed");
    const page = {
      url: "https://news.test/a",
      title: "A",
      excerpt: "x",
      contentHash: "h",
      fetchedAt: new Date(),
    };
    const one = await runAsSystem("ledger", () => t.store.addSource(started.id, page));
    const two = await runAsSystem("ledger", () => t.store.addSource(started.id, page));
    expect(two.position).toBe(one.position);
    await runAsSystem("finish", () =>
      t.store.finish(started.id, {
        status: "finished",
        stopReason: "enough",
        report: "Summary [1].",
        changed: true,
      }),
    );
    expect((await t.job(started.id)).status).toBe("finished");
    expect(await t.wakes()).toHaveLength(1);
    expect(t.enqueue.mock.calls.some(([job]) => job.name === "run.continue")).toBe(true);
    // Finishing twice wakes once.
    await runAsSystem("finish", () =>
      t.store.finish(started.id, { status: "finished", report: "Again [1].", changed: true }),
    );
    expect(await t.wakes()).toHaveLength(1);
    const status = await runAsSystem("status", () =>
      executeResearchStatus(t.deps, t.context(), { threadId: t.thread.id }, { id: started.id }),
    );
    expect(status).toMatchObject({ status: "finished", report: "Summary [1].", sources: 1 });
  });

  it("finds the last report of the same question to compare with", async () => {
    const t = await setup("routine");
    const first = await t.start("Watch the pricing page");
    if (!("id" in first)) throw new Error("start failed");
    // A recurring job leaves no card.
    expect((await t.job(first.id)).messageId).toBeNull();
    await runAsSystem("finish", () =>
      t.store.finish(first.id, { status: "finished", report: "Report one [1].", changed: true }),
    );
    const second = await t.start("  watch the PRICING page ");
    if (!("id" in second)) throw new Error("start failed");
    const record = await runAsSystem("load", () => t.store.load(second.id));
    const previous = await runAsSystem("previous", () => t.store.previous(record!));
    expect(previous).toEqual({ id: first.id, report: "Report one [1]." });
  });

  it("wakes nobody when a recurring job found nothing new", async () => {
    const t = await setup("routine");
    const started = await t.start("Watch the pricing page");
    if (!("id" in started)) throw new Error("start failed");
    await runAsSystem("finish", () =>
      t.store.finish(started.id, { status: "finished", changed: false }),
    );
    expect(await t.wakes()).toHaveLength(0);
    expect(await t.job(started.id)).toMatchObject({ status: "finished", changed: false });
  });

  it("ends a job that has run for hours and queues one that stalled", async () => {
    const t = await setup();
    const stalled = await t.start("stalled question");
    const old = await t.start("old question");
    if (!("id" in stalled) || !("id" in old)) throw new Error("start failed");
    await runAsSystem("age", async () => {
      await prisma.$executeRaw`UPDATE research_jobs SET "createdAt" = now() - interval '4 hours' WHERE id = ${old.id}`;
      await prisma.$executeRaw`UPDATE research_jobs SET "updatedAt" = now() - interval '20 minutes' WHERE id = ${stalled.id}`;
    });
    t.enqueue.mockClear();
    await reconcileResearch(t.deps);
    expect((await t.job(old.id)).status).toBe("failed");
    expect(
      t.enqueue.mock.calls.some(
        ([job]) => job.name === "research.run" && job.payload.researchId === stalled.id,
      ),
    ).toBe(true);
  });
});
