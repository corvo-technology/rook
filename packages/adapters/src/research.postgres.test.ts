import { randomUUID } from "node:crypto";
import type { AdapterContext, BackgroundJob, JobPublisher } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, runAsSystem, runAsTenant } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  executeResearchStart,
  executeResearchStatus,
  MAX_RUNNING_RESEARCH_PER_BOT,
  prismaResearchStore,
  reconcileResearch,
} from "./research-service.js";

/** The id of a started job; a refusal has none. */
function idOf(result: { id?: string; error?: string }): string {
  if (!result.id) throw new Error(result.error ?? "start failed");
  return result.id;
}

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
    const context = (operationId: string = randomUUID()): AdapterContext & { botId: string } => ({
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

  it("starts a job with a card, queues its run and answers a repeated call with the same job", async () => {
    const t = await setup();
    const operationId = randomUUID();
    const first = await t.start("What changed in team pricing?", operationId);
    const again = await t.start("What changed in team pricing?", operationId);
    expect(idOf(again)).toBe(idOf(first));
    expect(t.enqueue.mock.calls.filter(([job]) => job.name === "research.run")).not.toHaveLength(0);
    const firstId = idOf(first);
    const row = await t.job(firstId);
    expect(row.messageId).toBeTruthy();
    const message = await runAsSystem("read", () =>
      prisma.message.findUniqueOrThrow({ where: { id: row.messageId ?? "" } }),
    );
    expect(message.blocks).toEqual([
      { kind: "research", researchId: firstId, question: row.question, status: "running" },
    ]);
  });

  it("shows a job and its ledger to its own Space and to no other", async () => {
    const t = await setup();
    const other = await setup();
    const started = idOf(await t.start("Who can see this?"));
    await runAsSystem("ledger", () =>
      t.store.addSource(started, {
        url: "https://news.test/a",
        title: "A",
        excerpt: "x",
        contentHash: "h",
        fetchedAt: new Date(),
      }),
    );
    const seen = (scope: { spaceId: string; userId: string }) =>
      runAsTenant(scope, async () => ({
        jobs: await prisma.researchJob.count({ where: { id: started } }),
        sources: await prisma.researchSource.count({ where: { researchId: started } }),
      }));
    expect(await seen({ spaceId: t.id, userId: t.id })).toEqual({ jobs: 1, sources: 1 });
    expect(await seen({ spaceId: other.id, userId: other.id })).toEqual({ jobs: 0, sources: 0 });
  });

  it("caps the jobs one agent runs at once", async () => {
    const t = await setup();
    for (let i = 0; i < MAX_RUNNING_RESEARCH_PER_BOT; i += 1)
      expect(await t.start(`question ${i}`)).toHaveProperty("id");
    expect(await t.start("one too many")).toHaveProperty("error");
  });

  it("keeps the ledger once per page and finishes with a card update and a wake", async () => {
    const t = await setup();
    const started = idOf(await t.start("What changed in team pricing?"));
    const page = {
      url: "https://news.test/a",
      title: "A",
      excerpt: "x",
      contentHash: "h",
      fetchedAt: new Date(),
    };
    const one = await runAsSystem("ledger", () => t.store.addSource(started, page));
    const two = await runAsSystem("ledger", () => t.store.addSource(started, page));
    expect(two.position).toBe(one.position);
    await runAsSystem("finish", () =>
      t.store.finish(started, {
        status: "finished",
        stopReason: "enough",
        report: "Summary [1].",
        changed: true,
      }),
    );
    expect((await t.job(started)).status).toBe("finished");
    expect(await t.wakes()).toHaveLength(1);
    expect(t.enqueue.mock.calls.some(([job]) => job.name === "run.continue")).toBe(true);
    // Finishing twice wakes once.
    await runAsSystem("finish", () =>
      t.store.finish(started, { status: "finished", report: "Again [1].", changed: true }),
    );
    expect(await t.wakes()).toHaveLength(1);
    const status = await runAsSystem("status", () =>
      executeResearchStatus(t.deps, t.context(), { threadId: t.thread.id }, { id: started }),
    );
    expect(status).toMatchObject({ status: "finished", report: "Summary [1].", sources: 1 });
  });

  it("finds the last report of the same question to compare with", async () => {
    const t = await setup("routine");
    const first = idOf(await t.start("Watch the pricing page"));
    // A recurring job leaves no card.
    expect((await t.job(first)).messageId).toBeNull();
    await runAsSystem("finish", () =>
      t.store.finish(first, { status: "finished", report: "Report one [1].", changed: true }),
    );
    const second = idOf(await t.start("  watch the PRICING page "));
    const record = await runAsSystem("load", () => t.store.load(second));
    const previous = await runAsSystem("previous", () => t.store.previous(record!));
    expect(previous).toEqual({ id: first, report: "Report one [1]." });
  });

  it("wakes nobody when a recurring job found nothing new", async () => {
    const t = await setup("routine");
    const started = idOf(await t.start("Watch the pricing page"));
    await runAsSystem("finish", () =>
      t.store.finish(started, { status: "finished", changed: false }),
    );
    expect(await t.wakes()).toHaveLength(0);
    expect(await t.job(started)).toMatchObject({ status: "finished", changed: false });
  });

  it("ends a job that has run for hours and queues one that stalled", async () => {
    const t = await setup();
    const stalled = idOf(await t.start("stalled question"));
    const old = idOf(await t.start("old question"));
    await runAsSystem("age", async () => {
      await prisma.$executeRaw`UPDATE research_jobs SET "createdAt" = now() - interval '4 hours' WHERE id = ${old}`;
      await prisma.$executeRaw`UPDATE research_jobs SET "updatedAt" = now() - interval '20 minutes' WHERE id = ${stalled}`;
    });
    t.enqueue.mockClear();
    await reconcileResearch(t.deps);
    expect((await t.job(old)).status).toBe("failed");
    expect(
      t.enqueue.mock.calls.some(
        ([job]) => job.name === "research.run" && job.payload.researchId === stalled,
      ),
    ).toBe(true);
  });
});
