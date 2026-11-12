import { describe, expect, it } from "vitest";
import { createBoardEvents } from "./board-live.js";

function fakeFanout() {
  const subscribers = new Map<string, Set<(payload: string) => void>>();
  return {
    publish: async (topic: string, payload: string) => {
      for (const subscriber of subscribers.get(topic) ?? []) subscriber(payload);
    },
    subscribe: (topic: string, callback: (payload: string) => void) => {
      const set = subscribers.get(topic) ?? new Set();
      set.add(callback);
      subscribers.set(topic, set);
      return Promise.resolve(async () => {
        set.delete(callback);
      });
    },
  };
}

describe("createBoardEvents", () => {
  const moved = {
    ref: "RAK-3",
    title: "Call Ana",
    status: "review" as const,
    previousStatus: "doing" as const,
    statusLabel: "Check",
    byBotId: "bot-1",
    byName: "Planner",
  };

  it("carries what moved through the fanout, and drops a malformed move", async () => {
    const fanout = fakeFanout();
    const events = createBoardEvents(fanout as never);
    const iterator = events.follow("space-1")[Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await events.notify("space-1", { ticketId: "ticket-1", moved });
    expect((await pending).value).toMatchObject({ ticketId: "ticket-1", moved });
    const next = iterator.next();
    await fanout.publish(
      "board:space-1",
      JSON.stringify({ ticketId: "ticket-2", moved: { ref: 4, status: "nope" } }),
    );
    const bare = (await next).value;
    expect(bare).toMatchObject({ ticketId: "ticket-2" });
    expect(bare).not.toHaveProperty("moved");
    await iterator.return?.(undefined);
  });

  it("carries an agent's step and its end, and drops a malformed step", async () => {
    const fanout = fakeFanout();
    const events = createBoardEvents(fanout as never);
    const iterator = events.follow("space-1")[Symbol.asyncIterator]();
    let next = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const step = { botId: "bot-1", text: "Searching the web" };
    await events.notify("space-1", { ticketId: "ticket-1", step });
    expect((await next).value).toMatchObject({ ticketId: "ticket-1", step });
    next = iterator.next();
    await events.notify("space-1", { ticketId: "ticket-1", step: null });
    expect((await next).value).toMatchObject({ ticketId: "ticket-1", step: null });
    next = iterator.next();
    await fanout.publish("board:space-1", JSON.stringify({ ticketId: "t", step: { text: 4 } }));
    expect((await next).value).not.toHaveProperty("step");
    await iterator.return?.(undefined);
  });

  it("follows only the requested space and yields the change", async () => {
    const fanout = fakeFanout();
    const events = createBoardEvents(fanout as never);
    const iterator = events.follow("space-1")[Symbol.asyncIterator]();
    const pending = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await events.notify("space-2", { ticketId: "other" });
    await events.notify("space-1", { boardId: "board-1", ticketId: "ticket-1" });

    const first = await pending;
    expect(first.value).toMatchObject({
      spaceId: "space-1",
      boardId: "board-1",
      ticketId: "ticket-1",
    });
    await iterator.return?.(undefined);
  });

  it("does not throw without a realtime fanout", async () => {
    const events = createBoardEvents();
    await expect(events.notify("space-1")).resolves.toBeUndefined();
  });
});
