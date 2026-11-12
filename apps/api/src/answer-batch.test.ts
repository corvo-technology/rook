import type { Actor } from "@corvo/contracts";
import type { PrismaClient } from "@corvo/db";
import { createRouterClient } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const missions = vi.hoisted(() => ({ completeMission: vi.fn() }));

vi.mock("@corvo/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@corvo/db")>()),
  ...missions,
}));

import { withModelRoles } from "../../../packages/adapters/src/testing/model-roles.js";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@corvo.test",
  isDeploymentOwner: false,
} satisfies Actor;

function setup(
  decide: (runId: string) => boolean | Error,
  bot: unknown = { id: "bot-1", thread: { id: "thread-1" }, computer: null },
) {
  const enqueue = vi.fn(async () => undefined);
  const answerRunInput = vi.fn(async (input: { runId: string }) => {
    const outcome = decide(input.runId);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  });
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        email: actor.email,
        name: "Test",
        timezone: null,
        signupSurvey: null,
      }),
    },
    bot: { findFirst: vi.fn().mockResolvedValue(bot) },
    partnerTenant: { findFirst: vi.fn().mockResolvedValue(null) },
    userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
    deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    env: { defaultProvider: "fake", defaultModel: "fake-model", sandboxProvider: "fake" },
    dataDir: "/tmp/corvo-answer-batch-test",
    jobs: { enqueue },
    events: { answerRunInput },
  } as unknown as RouterDeps;
  withModelRoles(deps.prisma);
  const router = createRouter(deps);
  return {
    answerRunInput,
    enqueue,
    client: createRouterClient(router, { context: { actor } as never }),
    anonymous: createRouterClient(router, { context: {} as never }),
  };
}

const batch = {
  botId: "bot-1",
  batchClass: "tool" as const,
  items: [
    { runId: "run-1", messageId: "message-1", approvalEffectId: "effect-1" },
    { runId: "run-2", messageId: "message-2", approvalEffectId: "effect-2" },
    { runId: "run-3", messageId: "message-3", approvalEffectId: "effect-3" },
  ],
};

describe("threads.answerBatch", () => {
  beforeEach(() => missions.completeMission.mockReset().mockResolvedValue(undefined));

  it("allows each item through the single-answer path, scoped to the batch class", async () => {
    const { client, answerRunInput, enqueue } = setup(() => true);
    const { results } = await client.threads.answerBatch(batch);
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    expect(answerRunInput).toHaveBeenCalledTimes(3);
    expect(answerRunInput).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: "space-1",
        threadId: "thread-1",
        runId: "run-2",
        messageId: "message-2",
        answeredByUserId: "user-1",
        answer: "allow",
        approvalEffectId: "effect-2",
        batchClass: "tool",
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(missions.completeMission).toHaveBeenCalledOnce();
  });

  it("reports each failure by item and still decides the others", async () => {
    const { client, enqueue } = setup((runId) =>
      runId === "run-2" ? false : runId === "run-3" ? new Error("database unavailable") : true,
    );
    const { results } = await client.threads.answerBatch(batch);
    expect(results.map((result) => [result.approvalEffectId, result.ok])).toEqual([
      ["effect-1", true],
      ["effect-2", false],
      ["effect-3", false],
    ]);
    expect(results[1]?.error).toBeTruthy();
    expect(JSON.stringify(results)).not.toContain("database unavailable");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("does not resume or complete a mission when nothing was decided", async () => {
    const { client, enqueue } = setup(() => false);
    await client.threads.answerBatch(batch);
    expect(enqueue).not.toHaveBeenCalled();
    expect(missions.completeMission).not.toHaveBeenCalled();
  });

  it("refuses anonymous callers and a chat the actor cannot reach", async () => {
    const { anonymous, answerRunInput } = setup(() => true);
    await expect(anonymous.threads.answerBatch(batch)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const missing = setup(() => true, null);
    await expect(missing.client.threads.answerBatch(batch)).rejects.toBeTruthy();
    expect(answerRunInput).not.toHaveBeenCalled();
    expect(missing.answerRunInput).not.toHaveBeenCalled();
  });

  it("refuses an empty batch, too many items and an unknown class", async () => {
    const { client, answerRunInput } = setup(() => true);
    await expect(client.threads.answerBatch({ ...batch, items: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      client.threads.answerBatch({
        ...batch,
        items: Array.from({ length: 21 }, (_, i) => ({
          runId: `run-${i}`,
          messageId: `message-${i}`,
          approvalEffectId: `effect-${i}`,
        })),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.threads.answerBatch({ ...batch, batchClass: "secret" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(answerRunInput).not.toHaveBeenCalled();
  });
});
