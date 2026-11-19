// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEmbedForTests } from "./embed";
import {
  answerHostAction,
  hostAsk,
  hostState,
  onHostAsk,
  rememberHostResult,
  resetHostForTests,
  runHostAction,
  setHostActions,
  setHostContext,
  takeHostTurn,
} from "./embed-host";

beforeEach(() => {
  resetHostForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetEmbedForTests();
});

describe("takeHostTurn", () => {
  it("is nothing until the page says something", () => {
    expect(takeHostTurn()).toBeUndefined();
  });

  it("carries the context and actions on every message, and a result only once", () => {
    setHostContext({
      page: "/clientes/1",
      entities: [{ type: "customer", id: "1", label: "Carlos" }],
    });
    setHostActions([
      {
        name: "open_agenda",
        description: "",
        params: { type: "object", properties: {}, required: [] },
      },
    ]);
    rememberHostResult({ name: "open_agenda", outcome: "done" });
    expect(takeHostTurn()).toMatchObject({
      context: { page: "/clientes/1" },
      actions: [{ name: "open_agenda" }],
      results: [{ name: "open_agenda", outcome: "done" }],
    });
    const again = takeHostTurn();
    expect(again?.results).toBeUndefined();
    expect(again?.context).toBeDefined();
  });
});

describe("hostAsk", () => {
  it("reaches the chat that is listening", () => {
    const heard = vi.fn();
    const off = onHostAsk(heard);
    hostAsk("Quem vem hoje?");
    expect(heard).toHaveBeenCalledWith("Quem vem hoje?");
    off();
    hostAsk("again");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("holds a question asked before the chat mounted", () => {
    hostAsk("early");
    const heard = vi.fn();
    onHostAsk(heard);
    expect(heard).toHaveBeenCalledWith("early");
  });
});

describe("runHostAction", () => {
  const card = { actionId: "a1", name: "book", params: { barber: "ana" } };

  it("asks the page and resolves with its answer", async () => {
    const post = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: post } as never);
    const result = runHostAction(card);
    expect(post).toHaveBeenCalledWith(
      { type: "corvo:action", id: "a1", name: "book", params: { barber: "ana" } },
      "*",
    );
    answerHostAction("a1", { ok: true, result: "ok" });
    await expect(result).resolves.toEqual({ outcome: "done", result: "ok" });
  });

  it("counts a page that never answers as a failed action", async () => {
    vi.spyOn(window, "parent", "get").mockReturnValue({ postMessage: vi.fn() } as never);
    const result = runHostAction(card);
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(result).resolves.toEqual({ outcome: "failed" });
  });

  it("ignores an answer for an action nobody asked about", () => {
    answerHostAction("unknown", { ok: true });
    expect(hostState().results).toEqual([]);
  });
});
