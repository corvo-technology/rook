import { describe, expect, it, vi } from "vitest";

const raiseNotification = vi.hoisted(() => vi.fn(async () => "n"));
vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  raiseNotification,
  countUnreadInboxChats: vi.fn(async () => 0),
}));

import type { ExecutorDeps } from "./executor-deps.js";
import { notifyRun } from "./run-notifications.js";

const run = { spaceId: "s", userId: "u", botId: "b", threadId: "t", trigger: "message" };
const deps = (send = vi.fn(async () => undefined)) =>
  ({
    prisma: {
      run: { findFirst: vi.fn(async () => null) },
      routine: { findUnique: vi.fn() },
    },
    notifications: { send },
  }) as unknown as ExecutorDeps;
const notice = (kind: "help" | "failure" | "completion" | "takeover") => ({
  kind,
  title: "Ana needs an answer",
  body: "text",
  botId: "b",
  threadId: "t",
});

describe("notifyRun and the inbox", () => {
  it("keeps a question for the person even when their push settings send nothing", async () => {
    raiseNotification.mockClear();
    await notifyRun(deps(), run, notice("help"));
    expect(raiseNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "u",
        kind: "question",
        dedupeKey: "question:t",
        threadId: "t",
        botId: "b",
      }),
    );
  });

  it("keeps an approval as an approval and a failure of a routine as a failure", async () => {
    raiseNotification.mockClear();
    await notifyRun(deps(), run, notice("help"), { inbox: "approval" });
    await notifyRun(deps(), { ...run, trigger: "routine" }, notice("failure"));
    expect(
      raiseNotification.mock.calls.map(([, input]) => (input as { kind: string }).kind),
    ).toEqual(["approval", "failure"]);
  });

  it("raises nothing for a completion, and a failed write never fails the run", async () => {
    raiseNotification.mockClear();
    await notifyRun(deps(), run, notice("completion"));
    expect(raiseNotification).not.toHaveBeenCalled();
    raiseNotification.mockRejectedValueOnce(new Error("db down"));
    await expect(notifyRun(deps(), run, notice("failure"))).resolves.toBeUndefined();
  });

  it("carries the product's own line for a generic alert", async () => {
    raiseNotification.mockClear();
    await notifyRun(
      deps(),
      run,
      { ...notice("help"), title: "Ana used 80% of its limit" },
      {
        inbox: "alert",
      },
    );
    expect(raiseNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "alert", detail: "Ana used 80% of its limit" }),
    );
  });
});
