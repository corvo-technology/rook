import type { AgentRuntime } from "@corvo/adapter-kit";
import type { PrismaClient } from "@corvo/db";
import { describe, expect, it, vi } from "vitest";
import { runSideModel, type SideModelBot } from "./side-model.js";

const bot: SideModelBot = {
  id: "bot-1",
  spaceId: "space-1",
  userId: "user-1",
  modelProvider: "main-provider",
  modelId: "main-model",
};

function setup(resolveFastModel?: () => Promise<{ provider: string; id: string } | undefined>) {
  const run = vi.fn(async function* () {
    yield { type: "done", text: "ok" };
  });
  const prisma = {
    deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    modelCredential: { findFirst: vi.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient;
  const deps = {
    prisma,
    runtime: { run } as unknown as AgentRuntime,
    secrets: {} as never,
    deploymentProvider: "deploy-provider",
    deploymentModel: "deploy-model",
    resolveFastModel,
  };
  return {
    run,
    call: () =>
      runSideModel(deps, bot, { operation: "t", prompt: "p", instructions: "i", timeoutMs: 1_000 }),
  };
}

describe("runSideModel with a fast model", () => {
  it("runs on the member's fast model when one is chosen", async () => {
    const { run, call } = setup(async () => ({ provider: "fast-provider", id: "fast-model" }));
    expect(await call()).toBe("ok");
    expect(run.mock.calls[0]![0].model).toMatchObject({
      provider: "fast-provider",
      id: "fast-model",
    });
  });
});
