import type { PrismaClient } from "@corvo/db";
import { asSystem, createDb, ensureBoard, runAsTenant } from "@corvo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TicketChange } from "./ticket-changes.js";
import { endTicketRun, startTicketRun, waitTicketRun } from "./ticket-run-moves.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && databaseUrl ? describe.sequential : describe.skip;

describePostgres("a run's ticket moves (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `run-moves-org-${suffix}`;
  const spaceId = `run-moves-space-${suffix}`;
  const userId = `run-moves-user-${suffix}`;
  const tenant = { spaceId, userId };
  let prisma: PrismaClient;
  let fixtures: PrismaClient;
  let close: () => Promise<void>;
  let boardId: string;
  let botId: string;
  let threadId: string;
  let taskId: string;
  let number = 0;

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    fixtures = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
    await fixtures.user.create({
      data: { id: userId, name: "Mover", email: `${userId}@example.test` },
    });
    await fixtures.organization.create({
      data: { id: organizationId, name: "Moves Org", slug: organizationId, createdAt: new Date() },
    });
    await fixtures.space.create({
      data: { id: spaceId, organizationId, name: "General", isDefault: true },
    });
    boardId = (await runAsTenant(tenant, () => ensureBoard(prisma, spaceId))).id;
    const bot = await fixtures.bot.create({
      data: { spaceId, userId, name: "Ana", color: "blue" },
    });
    botId = bot.id;
    const thread = await fixtures.thread.create({ data: { spaceId, userId, botId } });
    threadId = thread.id;
    taskId = (
      await fixtures.task.create({
        data: { spaceId, userId, botId, threadId, prompt: "Work", status: "running" },
      })
    ).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await fixtures.organization.deleteMany({ where: { id: organizationId } });
    await fixtures.user.delete({ where: { id: userId } });
    await close();
  });

  async function fixture(status = "todo") {
    number += 1;
    const ticket = await fixtures.ticket.create({
      data: { spaceId, boardId, number, title: "Call", status, assigneeBotId: botId },
    });
    const row = await fixtures.run.create({
      data: {
        spaceId,
        userId,
        botId,
        threadId,
        taskId,
        status: "running",
        trigger: "tickets",
        ticketId: ticket.id,
      },
    });
    const changes: TicketChange[] = [];
    const deps = {
      prisma,
      ticketBoardEnabled: true,
      onTicketChange: async (change: TicketChange) => {
        changes.push(change);
      },
    };
    const run = { id: row.id, spaceId, botId, ticketId: ticket.id };
    const status_ = async () =>
      (await fixtures.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status;
    const manualMove = (to: string) =>
      fixtures.ticket.update({ where: { id: ticket.id }, data: { status: to } });
    return { deps, run, changes, ticket, status: status_, manualMove };
  }

  const inTenant = <T>(work: () => Promise<T>) => runAsTenant(tenant, work);

  it("walks a ticket through start, wait, resume and finish, once each", async () => {
    const { deps, run, status, changes } = await fixture();
    await inTenant(() => startTicketRun(deps, run));
    await inTenant(() => startTicketRun(deps, run));
    expect(await status()).toBe("doing");
    await inTenant(() => waitTicketRun(deps, run));
    expect(await status()).toBe("review");
    await inTenant(() => startTicketRun(deps, run));
    expect(await status()).toBe("doing");
    await inTenant(() => endTicketRun(deps, run, { kind: "finished" }));
    await inTenant(() => endTicketRun(deps, run, { kind: "finished" }));
    expect(await status()).toBe("review");
    expect(changes.filter((change) => change.moved)).toHaveLength(4);
  });

  it("blocks a failed run's ticket with the error as a comment", async () => {
    const { deps, run, status, ticket } = await fixture();
    await inTenant(() => startTicketRun(deps, run));
    await inTenant(() => endTicketRun(deps, run, { kind: "stopped", error: "Key refused." }));
    expect(await status()).toBe("blocked");
    const comments = await fixtures.ticketComment.findMany({ where: { ticketId: ticket.id } });
    expect(comments).toEqual([
      expect.objectContaining({ authorBotId: botId, body: "Key refused." }),
    ]);
  });

  it("never overrides a person's move made after the run started", async () => {
    const { deps, run, status, manualMove } = await fixture();
    await inTenant(() => startTicketRun(deps, run));
    await manualMove("done");
    await inTenant(() => waitTicketRun(deps, run));
    await inTenant(() => endTicketRun(deps, run, { kind: "finished" }));
    expect(await status()).toBe("done");
  });

  it("keeps a person's move to Review when the run resumes", async () => {
    const { deps, run, status, manualMove } = await fixture();
    await inTenant(() => startTicketRun(deps, run));
    await manualMove("review");
    await inTenant(() => startTicketRun(deps, run));
    expect(await status()).toBe("review");
  });

  it("leaves a ticket of another agent alone", async () => {
    const { deps, run, status, ticket } = await fixture();
    await fixtures.ticket.update({ where: { id: ticket.id }, data: { assigneeBotId: null } });
    await inTenant(() => startTicketRun(deps, run));
    expect(await status()).toBe("todo");
  });

  it("does nothing while the board is off", async () => {
    const { deps, run, status } = await fixture();
    await inTenant(() => startTicketRun({ ...deps, ticketBoardEnabled: false }, run));
    expect(await status()).toBe("todo");
  });
});
