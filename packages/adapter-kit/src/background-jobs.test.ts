import { describe, expect, it, vi } from "vitest";
import {
  audioTranscribeJob,
  dispatchBackgroundJob,
  HISTORY_COMPACT_MAX_ATTEMPTS,
  historyCompactJob,
  historyCompactJobKey,
  messagingDeliverJob,
  parseBackgroundJob,
  routineRetryJob,
  WIKI_CURATE_MAX_ATTEMPTS,
  WIKI_CURATE_QUIET_MS,
  wikiCurateJob,
} from "./background-jobs.js";
import type { BackgroundJobHandlers } from "./types.js";

function handlers(): BackgroundJobHandlers {
  return {
    "run.continue": vi.fn(async () => undefined),
    "routine.wakeup": vi.fn(async () => undefined),
    "routine.retry": vi.fn(async () => undefined),
    "routine.next-step": vi.fn(async () => undefined),
    "computer.update": vi.fn(async () => undefined),
    "computer.sleep": vi.fn(async () => undefined),
    "computer.control-expire": vi.fn(async () => undefined),
    "skill.teaching-expire": vi.fn(async () => undefined),
    "call.expire": vi.fn(async () => undefined),
    "history.compact": vi.fn(async () => undefined),
    "wiki.curate": vi.fn(async () => undefined),
    "wiki.import": vi.fn(async () => undefined),
    "bot.design-avatar": vi.fn(async () => undefined),
    "messaging.deliver": vi.fn(async () => undefined),
    "messaging.credential-cleanup": vi.fn(async () => undefined),
    "cloud_agent.poll": vi.fn(async () => undefined),
    "push.receipt": vi.fn(async () => undefined),
    "audio.transcribe": vi.fn(async () => undefined),
  };
}

describe("background job contracts", () => {
  it("validates and dispatches messaging.deliver", async () => {
    const target = handlers();
    await dispatchBackgroundJob(target, "messaging.deliver", { runId: "run-1" });
    expect(target["messaging.deliver"]).toHaveBeenCalledWith({ runId: "run-1" });
    expect(messagingDeliverJob("run-1")).toEqual({
      name: "messaging.deliver",
      payload: { runId: "run-1" },
      replaceKey: "messaging.deliver:run-1",
    });
    expect(messagingDeliverJob()).toEqual({
      name: "messaging.deliver",
      payload: {},
      replaceKey: "messaging.deliver:drain",
    });
  });

  it("validates and dispatches retired messaging credential cleanup", async () => {
    const target = handlers();
    const payload = { installationId: "install-a", ref: "encrypted-reference" };
    await dispatchBackgroundJob(target, "messaging.credential-cleanup", payload);
    expect(target["messaging.credential-cleanup"]).toHaveBeenCalledWith(payload);
    expect(() =>
      parseBackgroundJob("messaging.credential-cleanup", { ref: "encrypted-reference" }),
    ).toThrow();
  });

  it("validates and dispatches a typed job", async () => {
    const target = handlers();
    await dispatchBackgroundJob(target, "routine.wakeup", {
      routineId: "routine-1",
      scheduledFor: "2026-08-15T12:00:00.000Z",
    });
    expect(target["routine.wakeup"]).toHaveBeenCalledWith({
      routineId: "routine-1",
      scheduledFor: "2026-08-15T12:00:00.000Z",
    });
  });

  it("validates and dispatches a routine retry keyed to the failed run", async () => {
    const target = handlers();
    await dispatchBackgroundJob(target, "routine.retry", { runId: "run-1" });
    expect(target["routine.retry"]).toHaveBeenCalledWith({ runId: "run-1" });
    expect(() => parseBackgroundJob("routine.retry", { runId: "" })).toThrow();
    const availableAt = new Date("2026-08-15T12:12:00.000Z");
    expect(routineRetryJob("run-1", availableAt)).toEqual({
      name: "routine.retry",
      payload: { runId: "run-1" },
      availableAt,
      replaceKey: "routine.retry:run-1",
    });
  });

  it("rejects unknown names and malformed deliveries", () => {
    expect(() => parseBackgroundJob("unknown", {})).toThrow("Unknown background job");
    expect(() =>
      parseBackgroundJob("routine.wakeup", {
        routineId: "routine-1",
        scheduledFor: "not-a-date",
      }),
    ).toThrow();
    expect(() => parseBackgroundJob("run.continue", { runId: "" })).toThrow();
    expect(() =>
      parseBackgroundJob("computer.control-expire", {
        computerId: "computer-1",
        leaseId: "",
      }),
    ).toThrow();
  });
});

describe("historyCompactJob", () => {
  it("builds a job with a replace key scoped to the thread", () => {
    expect(historyCompactJob("thread-1")).toEqual({
      name: "history.compact",
      payload: { threadId: "thread-1" },
      replaceKey: historyCompactJobKey("thread-1"),
      maxAttempts: HISTORY_COMPACT_MAX_ATTEMPTS,
    });
  });

  it("caps attempts below the queue default so a stuck thread cannot storm", () => {
    expect(HISTORY_COMPACT_MAX_ATTEMPTS).toBeLessThan(25);
  });

  it("keys different threads differently", () => {
    expect(historyCompactJobKey("thread-1")).not.toBe(historyCompactJobKey("thread-2"));
  });
});

describe("wikiCurateJob", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("waits for the conversation to go quiet, and a newer reply pushes it back", () => {
    const job = wikiCurateJob("thread-1", { now });
    expect(job).toEqual({
      name: "wiki.curate",
      payload: { threadId: "thread-1" },
      replaceKey: "wiki.curate:thread-1",
      availableAt: new Date(now.getTime() + WIKI_CURATE_QUIET_MS),
      maxAttempts: WIKI_CURATE_MAX_ATTEMPTS,
    });
    expect(WIKI_CURATE_QUIET_MS).toBe(20_000);
    expect(WIKI_CURATE_MAX_ATTEMPTS).toBe(3);
  });

  it("keeps a message at once, under a key of its own so it never replaces the quiet read", () => {
    const job = wikiCurateJob("thread-1", { messageId: "message-9" });
    expect(job.payload).toEqual({ threadId: "thread-1", messageId: "message-9" });
    expect(job.replaceKey).toBe("wiki.curate:thread-1:message-9");
    expect(job.availableAt).toBeUndefined();
  });

  it("parses back from the queue, and refuses a payload without a thread", () => {
    expect(parseBackgroundJob("wiki.curate", { threadId: "t", messageId: "m" }).payload).toEqual({
      threadId: "t",
      messageId: "m",
    });
    expect(() => parseBackgroundJob("wiki.curate", {})).toThrow();
  });
});

describe("audio.transcribe", () => {
  it("parses a job that names a run, and rejects one that does not", () => {
    expect(parseBackgroundJob("audio.transcribe", { runId: "run-1" })).toEqual({
      name: "audio.transcribe",
      payload: { runId: "run-1" },
    });
    expect(() => parseBackgroundJob("audio.transcribe", { runId: "" })).toThrow();
    expect(() => parseBackgroundJob("audio.transcribe", {})).toThrow();
  });

  it("is keyed by run, so a repeated enqueue is one job", () => {
    const first = audioTranscribeJob("run-1");
    expect(first).toMatchObject({ name: "audio.transcribe", payload: { runId: "run-1" } });
    expect(first.replaceKey).toBe(audioTranscribeJob("run-1").replaceKey);
    expect(first.replaceKey).not.toBe(audioTranscribeJob("run-2").replaceKey);
  });
});
