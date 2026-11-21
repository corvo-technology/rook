import type { AdapterContext } from "@corvo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import type { ExecutorDeps } from "./executor-deps.js";
import { repeatHintForRun, repeatHintInBackground } from "./run-repeat.js";

const context = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space",
  userId: "user",
  signal: new AbortController().signal,
} as AdapterContext & { signal: AbortSignal };
const scope = { runId: "r", spaceId: "space", userId: "user", botId: "bot", threadId: "thread" };
const input = {
  request: "ClickUp summary please",
  sourceMessageId: "m-now",
  own: { provider: "p", modelId: "m" },
  context,
};

describe("repeatHintForRun", () => {
  it("looks only at the owner's earlier typed requests in this thread, not the new one", async () => {
    const findMany = vi.fn(async (_query: unknown) => []);
    const deps = { prisma: { message: { findMany } } } as unknown as ExecutorDeps;
    expect(await repeatHintForRun(deps, scope, input)).toBeUndefined();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        threadId: "thread",
        role: "user",
        id: { not: "m-now" },
        sourceRuns: { some: { trigger: "user" } },
      },
    });
  });

  it("asks no model when there is not enough history", async () => {
    const findMany = vi.fn(async () => [{ blocks: [{ kind: "text", text: "one" }] }]);
    const deps = {
      prisma: { message: { findMany }, spaceModelRoleChoice: { findMany: vi.fn() } },
    } as unknown as ExecutorDeps;
    expect(await repeatHintForRun(deps, scope, input)).toBeUndefined();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("offers nothing when the history cannot be read", async () => {
    const deps = {
      prisma: {
        message: {
          findMany: async () => {
            throw new Error("down");
          },
        },
      },
    } as unknown as ExecutorDeps;
    expect(await repeatHintForRun(deps, scope, input)).toBeUndefined();
  });
});

describe("repeatHintInBackground", () => {
  it("never holds the turn: the hint is read when ready and absent before", async () => {
    let release: (rows: { blocks: unknown }[]) => void = () => undefined;
    const findMany = vi.fn(
      () => new Promise<{ blocks: unknown }[]>((resolve) => (release = resolve)),
    );
    const deps = { prisma: { message: { findMany } } } as unknown as ExecutorDeps;
    const read = repeatHintInBackground(deps, scope, input);
    expect(read()).toBeUndefined();
    release([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(read()).toBeUndefined();
  });
});
