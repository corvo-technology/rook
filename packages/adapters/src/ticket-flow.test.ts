import { runContinueJob } from "@corvo/adapter-kit";
import { TICKET_CONTINUATIONS_MAX, TICKET_REVIEW_ROUNDS_MAX } from "@corvo/contracts";
import { describe, expect, it } from "vitest";
import { endTicketRun, startTicketRun } from "./ticket-run-moves.js";
import { createTicket, updateTicket } from "./ticket-tools.js";
import type { World } from "./ticket-world.test-support.js";
import { world } from "./ticket-world.test-support.js";

const input = { spaceId: "ws", userId: "u1", botId: "chief" };

/** The owner's run on a ticket starts and ends, the way the executor drives it. */
async function workerRun(w: World, ref: string, outcome: Parameters<typeof endTicketRun>[2]) {
  const ticket = w.ticketByRef(ref);
  const run = [...w.runs].reverse().find((row) => row.ticketId === ticket.id)!;
  const turn = { id: run.id, spaceId: "ws", botId: run.botId, ticketId: ticket.id };
  await startTicketRun(w.deps, turn);
  await endTicketRun(w.deps, turn, outcome);
  run.status = "completed";
}

async function chiefCreates(w: World, title: string, owner: string, blockedBy?: string[]) {
  const created = await createTicket(w.deps, {
    ...input,
    title,
    ownerBotId: owner,
    acceptanceCriteria: "1 item delivered",
    blockedBy,
  });
  if (!("ticket" in created) || !created.ticket) throw new Error(JSON.stringify(created));
  return created.ticket.ref;
}

describe("ticket dependencies", () => {
  it("does not wake a ticket until its blocker is done, then wakes it once", async () => {
    const w = world();
    const a = await chiefCreates(w, "Define", "theo");
    const b = await chiefCreates(w, "Map", "rafa", [a]);
    expect(w.prompts("theo")).toHaveLength(1);
    expect(w.prompts("rafa")).toHaveLength(0);

    const first = w.ticketByRef(a);
    await updateTicket(w.deps, { ...input, id: first.id, status: "done" });
    await updateTicket(w.deps, { ...input, id: first.id, status: "done" });
    expect(w.prompts("rafa")).toHaveLength(1);
    expect(w.prompts("rafa")[0]).toContain(`Work on ticket ${b}`);
  });

  it("waits for every blocker", async () => {
    const w = world();
    const a = await chiefCreates(w, "A", "theo");
    const b = await chiefCreates(w, "B", "theo");
    await chiefCreates(w, "C", "rafa", [a, b]);
    await updateTicket(w.deps, { ...input, id: w.ticketByRef(a).id, status: "done" });
    expect(w.prompts("rafa")).toHaveLength(0);
    await updateTicket(w.deps, { ...input, id: w.ticketByRef(b).id, status: "done" });
    expect(w.prompts("rafa")).toHaveLength(1);
  });

  it("refuses an unknown blocker and a cycle", async () => {
    const w = world();
    expect(await createTicket(w.deps, { ...input, title: "X", blockedBy: ["RAK-9"] })).toEqual({
      error: "blockedBy: ticket RAK-9 not found.",
    });
    const a = await chiefCreates(w, "A", "theo");
    const b = await chiefCreates(w, "B", "theo", [a]);
    const result = await updateTicket(w.deps, {
      ...input,
      id: w.ticketByRef(a).id,
      blockedBy: [b],
    });
    expect(result).toEqual({ error: expect.stringContaining("cannot wait on itself") });
  });
});

describe("continuation", () => {
  it("keeps a ticket in progress and wakes the owner when work remains", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await updateTicket(w.deps, {
      ...input,
      botId: "rafa",
      id: w.ticketByRef(a).id,
      remaining: "21 of 1000 done",
    });
    await workerRun(w, a, { kind: "finished" });
    const ticket = w.ticketByRef(a);
    expect(ticket.status).toBe("doing");
    expect(ticket.continuations).toBe(1);
    expect(w.prompts("rafa").at(-1)).toContain("Continue ticket");
    expect(w.comments.at(-1)?.body).toContain("21 of 1000 done");
    expect(w.prompts("chief")).toHaveLength(0);
  });

  it("continues after a guard stopped the run, but not after an ordinary failure", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await workerRun(w, a, { kind: "stopped", error: "Provider failed.", cut: false });
    expect(w.ticketByRef(a).status).toBe("blocked");

    const b = await chiefCreates(w, "Map more", "rafa");
    await workerRun(w, b, { kind: "stopped", error: "Stopped: no progress.", cut: true });
    expect(w.ticketByRef(b).status).toBe("doing");
    expect(w.prompts("rafa").at(-1)).toContain("Continue ticket");
  });

  it("continues when a tool limit forced the agent to wrap up", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await workerRun(w, a, { kind: "finished", cut: true });
    expect(w.ticketByRef(a).status).toBe("doing");
    expect(w.ticketByRef(a).continuations).toBe(1);
  });

  it("stops after the cap and goes to review with an honest comment", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    for (let i = 0; i < TICKET_CONTINUATIONS_MAX; i++) {
      await workerRun(w, a, { kind: "finished", cut: true });
    }
    expect(w.ticketByRef(a).status).toBe("doing");
    await workerRun(w, a, { kind: "finished", cut: true });
    expect(w.ticketByRef(a).status).toBe("review");
    expect(w.comments.at(-1)?.body).toContain(`Stopped after ${TICKET_CONTINUATIONS_MAX}`);
    expect(w.prompts("chief").at(-1)).toContain("Review ticket");
  });

  it("goes to review when the work is finished", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await workerRun(w, a, { kind: "finished" });
    expect(w.ticketByRef(a).status).toBe("review");
  });
});

describe("creator review", () => {
  it("wakes the creator on review, and approving finishes the ticket", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await workerRun(w, a, { kind: "finished" });
    expect(w.prompts("chief")).toHaveLength(1);
    expect(w.prompts("chief")[0]).toContain(`Review ticket ${a}`);
    expect(w.prompts("chief")[0]).toContain("count the rows");
    await updateTicket(w.deps, { ...input, id: w.ticketByRef(a).id, status: "done" });
    expect(w.ticketByRef(a).status).toBe("done");
    expect(w.prompts("chief")).toHaveLength(1);
  });

  it("sends it back to the owner with a fresh follow-up budget", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    await workerRun(w, a, { kind: "finished", cut: true });
    await workerRun(w, a, { kind: "finished" });
    expect(w.ticketByRef(a).continuations).toBe(1);
    await updateTicket(w.deps, { ...input, id: w.ticketByRef(a).id, status: "doing" });
    expect(w.ticketByRef(a).continuations).toBe(0);
    expect(w.prompts("rafa").at(-1)).toContain("came back from review");
  });

  it("asks the person after the review rounds are used up", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    for (let round = 1; round <= TICKET_REVIEW_ROUNDS_MAX; round++) {
      await workerRun(w, a, { kind: "finished" });
      expect(w.prompts("chief").at(-1)).toContain(`round ${round} of ${TICKET_REVIEW_ROUNDS_MAX}`);
      await updateTicket(w.deps, { ...input, id: w.ticketByRef(a).id, status: "doing" });
    }
    await workerRun(w, a, { kind: "finished" });
    const last = w.prompts("chief").at(-1)!;
    expect(last).toContain("message_user");
    expect(last).toContain("2 to 4 sentences");
    expect(last).not.toContain("Review ticket");
    expect(w.ticketByRef(a).status).toBe("review");
  });

  it("does not run a review for a ticket the owner parked waiting on a person", async () => {
    const w = world();
    const a = await chiefCreates(w, "Map", "rafa");
    const { waitTicketRun } = await import("./ticket-run-moves.js");
    const ticket = w.ticketByRef(a);
    const run = w.runs.find((row) => row.ticketId === ticket.id)!;
    const turn = { id: run.id, spaceId: "ws", botId: "rafa", ticketId: ticket.id };
    await startTicketRun(w.deps, turn);
    await waitTicketRun(w.deps, turn);
    expect(w.ticketByRef(a).status).toBe("review");
    expect(w.prompts("chief")).toHaveLength(0);
  });
});

describe("a sequenced plan", () => {
  it("runs four tickets in order, each reviewed before the next starts", async () => {
    const w = world();
    const owners = ["theo", "rafa", "theo", "theo"];
    const refs: string[] = [];
    for (const [index, owner] of owners.entries()) {
      refs.push(
        await chiefCreates(w, `Step ${index + 1}`, owner, index ? [refs[index - 1]!] : undefined),
      );
    }
    // Only the first one starts.
    expect(w.runs).toHaveLength(1);

    for (const [index, ref] of refs.entries()) {
      expect(w.runs.filter((run) => run.ticketId === w.ticketByRef(ref).id)).toHaveLength(1);
      expect(w.runs.filter((run) => run.botId !== "chief")).toHaveLength(index + 1);
      await workerRun(w, ref, { kind: "finished" });
      expect(w.ticketByRef(ref).status).toBe("review");
      // Not started yet: the next ticket waits for the review.
      expect(w.runs.filter((run) => run.botId !== "chief")).toHaveLength(index + 1);
      await updateTicket(w.deps, { ...input, id: w.ticketByRef(ref).id, status: "done" });
    }
    expect(refs.map((ref) => w.ticketByRef(ref).status)).toEqual(["done", "done", "done", "done"]);
    expect(w.runs.filter((run) => run.botId === "chief")).toHaveLength(4);
    expect(w.jobs.enqueue).toHaveBeenCalledWith(runContinueJob(w.runs[0]!.id));
  });
});
