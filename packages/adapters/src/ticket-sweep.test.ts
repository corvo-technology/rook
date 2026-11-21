import { TICKET_CONTINUATIONS_MAX, TICKET_REVIEW_ROUNDS_MAX } from "@corvo/contracts";
import { describe, expect, it, vi } from "vitest";
import { endTicketRun, startTicketRun } from "./ticket-run-moves.js";
import { createTicketSweeper } from "./ticket-sweep.js";
import { commentTicket, createTicket, updateTicket } from "./ticket-tools.js";
import type { World } from "./ticket-world.test-support.js";
import { NOW, world } from "./ticket-world.test-support.js";

const chief = { spaceId: "ws", userId: "u1", botId: "chief" };
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

function sweeper(w: World, at: Date, onTicketChange = w.onTicketChange) {
  return createTicketSweeper(
    { prisma: w.prisma as never, jobs: w.jobs as never, ticketBoardEnabled: true, onTicketChange },
    { now: () => at },
  );
}

async function create(w: World, title: string, owner: string, as = chief) {
  const result = await createTicket(w.deps, {
    ...as,
    title,
    ownerBotId: owner,
    acceptanceCriteria: "Delivered",
  });
  if (!("ticket" in result) || !result.ticket) throw new Error(JSON.stringify(result));
  return result.ticket.ref;
}

/** The owner's run starts and ends the way the executor drives it. */
async function work(w: World, ref: string, outcome: Parameters<typeof endTicketRun>[2]) {
  const ticket = w.ticketByRef(ref);
  const run = [...w.runs].reverse().find((row) => row.ticketId === ticket.id)!;
  const turn = { id: run.id, spaceId: "ws", botId: run.botId, ticketId: ticket.id };
  await startTicketRun(w.deps, turn);
  await endTicketRun(w.deps, turn, outcome);
  run.status = "completed";
}

describe("ticket lifecycle", () => {
  it("runs assign, work, review and done, one ticket at a time per agent", async () => {
    const w = world();
    const first = await create(w, "Build the list", "rafa");
    const second = await create(w, "Write the script", "rafa");
    // Assigned: the owner is woken for the first; the second waits because the owner is busy.
    expect(w.prompts("rafa")).toHaveLength(1);
    await sweeper(w, minutes(5))();
    expect(w.prompts("rafa")).toHaveLength(1);

    await work(w, first, { kind: "finished" });
    expect(w.ticketByRef(first).status).toBe("review");
    expect(w.prompts("chief")[0]).toContain(`Review ticket ${first}`);
    w.runs.find((run) => run.botId === "chief")!.status = "completed";
    await updateTicket(w.deps, { ...chief, id: w.ticketByRef(first).id, status: "done" });
    expect(w.ticketByRef(first).status).toBe("done");

    // The owner is free: the sweep starts the next ticket.
    await sweeper(w, minutes(6))();
    expect(w.prompts("rafa")).toHaveLength(2);
    expect(w.prompts("rafa")[1]).toContain(`Work on ticket ${second}`);
    await sweeper(w, minutes(7))();
    expect(w.prompts("rafa")).toHaveLength(2);
  });

  it("starts a ticket an agent created for itself, urgent ones first", async () => {
    const w = world();
    const rafa = { ...chief, botId: "rafa" };
    await create(w, "Normal", "rafa", rafa);
    const urgent = await create(w, "Urgent", "rafa", rafa);
    w.ticketByRef(urgent).priority = "urgent";
    expect(w.runs).toHaveLength(0);
    await sweeper(w, minutes(1))();
    expect(w.runs).toHaveLength(0);
    await sweeper(w, minutes(3))();
    expect(w.prompts("rafa")).toHaveLength(1);
    expect(w.prompts("rafa")[0]).toContain(`Work on ticket ${urgent}`);
  });

  it("leaves a ticket waiting on another alone until it is done", async () => {
    const w = world();
    const a = await create(w, "A", "theo");
    const b = await createTicket(w.deps, {
      ...chief,
      title: "B",
      ownerBotId: "rafa",
      blockedBy: [a],
    });
    expect("ticket" in b).toBe(true);
    await sweeper(w, minutes(10))();
    expect(w.prompts("rafa")).toHaveLength(0);
  });
});

describe("a stalled ticket", () => {
  function stalledTicket(w: World, ref: string) {
    const ticket = w.ticketByRef(ref);
    ticket.status = "doing";
    for (const run of w.runs) run.status = "completed";
    return ticket;
  }

  it("gets a follow-up run, and Blocked with a reason once the follow-ups are used up", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    const ticket = stalledTicket(w, ref);
    const changes = vi.fn(async () => {});
    await sweeper(w, minutes(10), changes)();
    expect(ticket.continuations).toBe(0);

    await sweeper(w, minutes(31), changes)();
    expect(ticket.continuations).toBe(1);
    expect(w.prompts("rafa").at(-1)).toContain("Continue ticket");
    expect(w.comments.at(-1)?.body).toContain("No activity");

    // A run that is working holds the ticket.
    await sweeper(w, minutes(62), changes)();
    expect(ticket.continuations).toBe(1);

    for (const run of w.runs) run.status = "completed";
    ticket.continuations = TICKET_CONTINUATIONS_MAX;
    await sweeper(w, minutes(93), changes)();
    expect(ticket.status).toBe("blocked");
    expect(w.comments.at(-1)).toMatchObject({
      authorBotId: "rafa",
      body: expect.stringContaining("no progress"),
    });
    expect(changes).toHaveBeenCalledWith(
      expect.objectContaining({
        moved: expect.objectContaining({ status: "blocked", previousStatus: "doing" }),
      }),
    );
    const runs = w.runs.length;
    await sweeper(w, minutes(130), changes)();
    expect(w.runs).toHaveLength(runs);
  });

  it("starts the follow-up count over when the last run made progress", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    const ticket = stalledTicket(w, ref);
    ticket.continuations = TICKET_CONTINUATIONS_MAX;
    // The last run commented on the ticket after it started, as an agent reporting a batch.
    w.comments.push({
      id: "c-progress",
      ticketId: ticket.id,
      authorBotId: "rafa",
      body: "267 of 1000 leads so far.",
      createdAt: new Date(NOW.getTime() + 3_600_000),
    });
    await sweeper(w, minutes(31))();
    expect(ticket.status).toBe("doing");
    expect(ticket.continuations).toBe(1);
    expect(w.comments.at(-1)?.body).toContain("follow-up 1 of");
    expect(w.prompts("rafa").at(-1)).toContain("Continue ticket");
  });

  it("keeps the cap for follow-ups that made no progress", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    const ticket = stalledTicket(w, ref);
    ticket.continuations = TICKET_CONTINUATIONS_MAX;
    await sweeper(w, minutes(31))();
    expect(ticket.status).toBe("blocked");
  });

  it("writes the follow-up and Blocked comments in the owner's language", async () => {
    const w = world();
    w.person.locale = "pt-BR";
    const ref = await create(w, "Map", "rafa");
    const ticket = stalledTicket(w, ref);
    await sweeper(w, minutes(31))();
    expect(w.comments.at(-1)?.body).toBe(
      "Sem atividade há 30 minutos. Continuando (retomada 1 de 8).",
    );

    for (const run of w.runs) run.status = "completed";
    ticket.continuations = TICKET_CONTINUATIONS_MAX;
    await sweeper(w, minutes(93))();
    expect(ticket.status).toBe("blocked");
    expect(w.comments.at(-1)?.body).toContain("Parado: sem progresso após 8 retomadas");
    expect(w.comments.at(-1)?.body).not.toContain("Stopped");
  });

  it("is not stalled while its owner waits on a person", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    const ticket = stalledTicket(w, ref);
    w.runs[0]!.status = "waiting_input";
    await sweeper(w, minutes(90))();
    expect(ticket.continuations).toBe(0);
  });
});

describe("a delivery in review", () => {
  it("goes to the Chief when the agent made the ticket for itself", async () => {
    const w = world();
    const rafa = { ...chief, botId: "rafa" };
    const ref = await create(w, "Prospect list", "rafa", rafa);
    const ticket = w.ticketByRef(ref);
    ticket.status = "review";
    await sweeper(w, minutes(11))();
    expect(w.prompts("chief")).toHaveLength(1);
    expect(w.prompts("chief")[0]).toContain(`Review ticket ${ref}`);
    expect(ticket.reviewRounds).toBe(1);
    // The review run is working, so the sweep does not start another.
    await sweeper(w, minutes(30))();
    expect(w.prompts("chief")).toHaveLength(1);
  });

  it("asks the person after the review rounds, and then stops", async () => {
    const w = world();
    const rafa = { ...chief, botId: "rafa" };
    const ref = await create(w, "Prospect list", "rafa", rafa);
    const ticket = w.ticketByRef(ref);
    ticket.status = "review";
    for (let round = 1; round <= TICKET_REVIEW_ROUNDS_MAX; round++) {
      await sweeper(w, minutes(11 * round))();
      expect(w.prompts("chief").at(-1)).toContain(`round ${round} of ${TICKET_REVIEW_ROUNDS_MAX}`);
      for (const run of w.runs) run.status = "completed";
    }
    await sweeper(w, minutes(60))();
    expect(w.prompts("chief").at(-1)).toContain("message_user");
    for (const run of w.runs) run.status = "completed";
    const runs = w.runs.length;
    await sweeper(w, minutes(90))();
    expect(w.runs).toHaveLength(runs);
    expect(ticket.status).toBe("review");
  });

  it("is left to the person when a person made the ticket", async () => {
    const w = world();
    const ref = await create(w, "Call back", "rafa", { ...chief, botId: undefined } as never);
    w.ticketByRef(ref).status = "review";
    await sweeper(w, minutes(30))();
    expect(w.prompts("chief")).toHaveLength(0);
  });

  it("is left alone while the owner waits on an approval", async () => {
    const w = world();
    const rafa = { ...chief, botId: "rafa" };
    const ref = await create(w, "Prospect list", "rafa", rafa);
    w.ticketByRef(ref).status = "review";
    w.runs.push({
      id: "r9",
      ticketId: w.ticketByRef(ref).id,
      botId: "rafa",
      status: "waiting_input",
    });
    await sweeper(w, minutes(30))();
    expect(w.prompts("chief")).toHaveLength(0);
  });
});

describe("follow-ups through the ticket", () => {
  it("wakes the owner on another agent's comment and takes a blocked ticket back", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    const ticket = w.ticketByRef(ref);
    for (const run of w.runs) run.status = "completed";
    ticket.status = "blocked";
    await commentTicket(w.deps, { ...chief, id: ticket.id, body: "Use the second source." });
    expect(ticket.status).toBe("doing");
    expect(w.prompts("rafa").at(-1)).toContain("Continue ticket");

    // The owner's own comment, or one while a run works, wakes nothing.
    const runs = w.runs.length;
    await commentTicket(w.deps, { ...chief, botId: "rafa", id: ticket.id, body: "Checkpoint." });
    await commentTicket(w.deps, { ...chief, id: ticket.id, body: "Another note." });
    expect(w.runs).toHaveLength(runs);
  });

  it("does not wake an owner whose ticket is already in review", async () => {
    const w = world();
    const ref = await create(w, "Map", "rafa");
    for (const run of w.runs) run.status = "completed";
    w.ticketByRef(ref).status = "review";
    const runs = w.runs.length;
    await commentTicket(w.deps, { ...chief, id: w.ticketByRef(ref).id, body: "Looks fine." });
    expect(w.runs).toHaveLength(runs);
  });
});

describe("ticket flooding", () => {
  it("returns the open ticket instead of a second one with the same title", async () => {
    const w = world();
    await create(w, "Prospect list", "rafa");
    const again = await createTicket(w.deps, {
      ...chief,
      title: "  prospect LIST ",
      ownerBotId: "rafa",
    });
    expect(again).toMatchObject({ existing: true, ticket: { ref: "RAK-1" } });
    expect(w.tickets.size).toBe(1);
  });

  it("refuses one ticket per item once ten are waiting for the owner", async () => {
    const w = world();
    for (let i = 1; i <= 10; i++) await create(w, `Lead ${i}`, "rafa");
    const eleventh = await createTicket(w.deps, { ...chief, title: "Lead 11", ownerBotId: "rafa" });
    expect(eleventh).toEqual({ error: expect.stringContaining("checklist of one ticket") });
    expect(w.tickets.size).toBe(10);
    // A person's tickets and another agent's are not capped by it.
    await create(w, "Lead 11", "rafa", { ...chief, botId: "theo" });
    expect(w.tickets.size).toBe(11);
  });

  it("does nothing when the board is off", async () => {
    const w = world();
    await create(w, "Map", "rafa");
    w.ticketByRef("RAK-1").status = "doing";
    for (const run of w.runs) run.status = "completed";
    await createTicketSweeper(
      { prisma: w.prisma as never, jobs: w.jobs as never, ticketBoardEnabled: false },
      { now: () => minutes(90) },
    )();
    expect(w.ticketByRef("RAK-1").continuations).toBe(0);
  });
});

describe("tickets from before the sweep", () => {
  const person = { spaceId: "ws", userId: "u1" };

  async function oldTickets(w: World) {
    const todo = await create(w, "Old to do", "rafa");
    const doing = await create(w, "Old doing", "theo");
    const review = await create(w, "Old review", "rafa", { ...chief, botId: "rafa" });
    for (const run of w.runs) run.status = "completed";
    w.ticketByRef(doing).status = "doing";
    w.ticketByRef(review).status = "review";
    for (const ref of [todo, doing, review]) w.ticketByRef(ref).sweepEligibleAt = null;
    return { todo, doing, review };
  }

  it("are ignored by the to do, stalled and review sweeps", async () => {
    const w = world();
    const { todo, doing, review } = await oldTickets(w);
    const before = w.runs.length;
    await sweeper(w, minutes(120))();
    expect(w.runs).toHaveLength(before);
    expect(w.ticketByRef(todo).status).toBe("todo");
    expect(w.ticketByRef(doing).status).toBe("doing");
    expect(w.ticketByRef(doing).continuations).toBe(0);
    expect(w.ticketByRef(review).reviewRounds).toBe(0);
  });

  it("are swept again once a person comments or reassigns", async () => {
    const w = world();
    const { todo, doing, review } = await oldTickets(w);
    const before = w.runs.length;
    await commentTicket(w.deps, { ...person, id: w.ticketByRef(todo).id, body: "Still needed" });
    await updateTicket(w.deps, { ...person, id: w.ticketByRef(doing).id, ownerBotId: "theo" });
    await updateTicket(w.deps, { ...person, id: w.ticketByRef(review).id, priority: "high" });
    for (const run of w.runs) run.status = "completed";
    expect(w.ticketByRef(todo).sweepEligibleAt).toBeTruthy();
    expect(w.ticketByRef(doing).sweepEligibleAt).toBeTruthy();
    expect(w.ticketByRef(review).sweepEligibleAt).toBeTruthy();
    await sweeper(w, minutes(120))();
    expect(w.runs.length).toBeGreaterThan(before);
  });

  it("stay ignored when only an agent comments", async () => {
    const w = world();
    const { todo } = await oldTickets(w);
    await commentTicket(w.deps, { ...chief, id: w.ticketByRef(todo).id, body: "Note" });
    expect(w.ticketByRef(todo).sweepEligibleAt).toBeNull();
  });

  it("do not stop a new ticket from being picked up", async () => {
    const w = world();
    await oldTickets(w);
    const fresh = await create(w, "Brand new", "mia");
    for (const run of w.runs) run.status = "completed";
    w.ticketByRef(fresh).sweepEligibleAt = new Date(NOW.getTime());
    await sweeper(w, minutes(10))();
    expect(w.prompts("mia").length).toBeGreaterThan(0);
  });
});
