import { runContinueJob } from "@corvo/adapter-kit";
import { MODEL_REQUIRED_SEND_ERROR } from "@corvo/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ needsModel: false }));
vi.mock("./shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared.js")>()),
  modelSetup: vi.fn(async () => ({ needsModel: shared.needsModel })),
}));
vi.mock("../thread-target.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../thread-target.js")>()),
  resolveThreadTarget: vi.fn(async () => ({ kind: "bot", botId: "bot-1", threadId: "thread-1" })),
}));

import { threadsRoutes } from "./threads.js";

const actor = { spaceId: "space-1", userId: "user-1" };
const input = { botId: "bot-1", runId: "run-failed" };

function handlers(retryFailedRun: ReturnType<typeof vi.fn>) {
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const passthrough = new Proxy({}, { get: () => ({ handler: (fn: unknown) => fn }) }) as unknown;
  const authed = new Proxy({}, { get: () => passthrough });
  const routes = threadsRoutes({
    deps: { prisma: {}, events: { retryFailedRun }, jobs: { enqueue } },
    authed,
    callsEnabled: authed,
  } as never);
  const retry = routes.threads.retry as unknown as (args: {
    context: { actor: typeof actor };
    input: typeof input;
  }) => Promise<{ runId: string }>;
  return { retry: () => retry({ context: { actor }, input }), enqueue };
}

describe("threads.retry", () => {
  beforeEach(() => {
    shared.needsModel = false;
  });

  it("asks to connect a model first", async () => {
    shared.needsModel = true;
    const retryFailedRun = vi.fn();
    await expect(handlers(retryFailedRun).retry()).rejects.toMatchObject({
      message: MODEL_REQUIRED_SEND_ERROR,
    });
    expect(retryFailedRun).not.toHaveBeenCalled();
  });

  it("answers CONFLICT when the run is no longer the one to retry", async () => {
    const { retry, enqueue } = handlers(vi.fn().mockResolvedValue(null));
    await expect(retry()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("starts the new run once, and nothing for a repeated retry", async () => {
    const created = handlers(vi.fn().mockResolvedValue({ runId: "run-retry", created: true }));
    await expect(created.retry()).resolves.toEqual({ runId: "run-retry" });
    expect(created.enqueue).toHaveBeenCalledExactlyOnceWith(runContinueJob("run-retry"));
    const repeated = handlers(vi.fn().mockResolvedValue({ runId: "run-retry", created: false }));
    await expect(repeated.retry()).resolves.toEqual({ runId: "run-retry" });
    expect(repeated.enqueue).not.toHaveBeenCalled();
  });
});
