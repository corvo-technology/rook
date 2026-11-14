import { once } from "node:events";
import type { Server } from "node:http";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as ComputerLifecycleModule from "./computer-lifecycle.js";

const provisionComputer = vi.hoisted(() => vi.fn());

vi.mock("./computer-lifecycle.js", async (importOriginal) => ({
  ...(await importOriginal<typeof ComputerLifecycleModule>()),
  acquireComputerExecutionLease: async () => null,
  acquireDedicatedScreenLeaseFence: async () => null,
  provisionComputer,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

beforeEach(() => {
  provisionComputer.mockReset();
  provisionComputer.mockResolvedValue({
    id: "sandbox-1",
    botId: "home-1",
    kind: "e2b",
    providerRef: "sandbox-1",
  });
});

/** The fake model either answers at once or starts a reply and never finishes it. */
async function startModel(mode: "answer" | "hang") {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "hang") {
        response.write(chunk({ role: "assistant", content: "Working on" }));
        return;
      }
      response.end(
        `${chunk({ role: "assistant", content: "Finished." })}${chunk({}, "stop")}data: [DONE]\n\n`,
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture endpoint unavailable");
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
}

async function stopModel(server: Server) {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
}

type Run = {
  id: string;
  botId: string;
  threadId: string;
  taskId: string;
  spaceId: string;
  userId: string;
  status: string;
  trigger: string;
  sourceMessageId: string;
  routineId: null;
  retryOfRunId: null;
  leaseOwner: string | null;
  leaseFence: number;
  leaseExpiresAt: Date | null;
  wakeAt: Date | null;
};

function newRun(): Run {
  return {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued",
    trigger: "user",
    sourceMessageId: "message-1",
    routineId: null,
    retryOfRunId: null,
    leaseOwner: null,
    leaseFence: 0,
    leaseExpiresAt: null,
    wakeAt: null,
  };
}

/** One executor over a shared run row, so two workers can contend for it like two pods. */
async function workerFor(run: Run, modelUrl: string, shutdownSignal?: AbortSignal) {
  vi.stubEnv("CORVO_LOCAL_MODELS", "example-model");
  vi.stubEnv("CORVO_LOCAL_VISION_MODELS", "example-model");
  vi.stubEnv("CORVO_LOCAL_CONTEXT_WINDOW", "120000");
  vi.stubEnv("CORVO_LOCAL_MODELS_URL", modelUrl);
  vi.resetModules();
  const { PiAgentRuntime } = await import("./pi-runtime.js");
  const { createRunExecutor } = await import("./executor.js");
  const options = { spentBefore: 0n };
  const empty = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    count: async () => 0,
    updateMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }),
    create: async () => ({}),
    upsert: async () => ({}),
    update: async () => ({}),
  };
  // The run records each computer action as an effect so a crashed one is never replayed.
  type Effect = { id: string; status: string; idempotencyKey?: string } & Record<string, unknown>;
  const effects: Effect[] = [];
  const externalEffect = {
    findMany: async ({ where = {} }: { where?: Record<string, unknown> } = {}) =>
      effects.filter((e) =>
        ["id", "runId", "status", "kind"].every((key) => !where[key] || e[key] === where[key]),
      ),
    findFirst: async () => null,
    findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) =>
      effects.find((e) =>
        where.id ? e.id === where.id : e.idempotencyKey === where.idempotencyKey,
      ) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const effect = { ...data, id: `effect-${effects.length + 1}` } as Effect;
      effects.push(effect);
      return { ...effect };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Object.assign(effects.find((e) => e.id === where.id) ?? {}, data),
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Record<string, unknown>;
    }) => {
      const effect = effects.find(
        (e) => e.id === where.id && (!where.status || e.status === where.status),
      );
      if (effect) Object.assign(effect, data);
      return { count: effect ? 1 : 0 };
    },
  };
  const prisma = {
    externalEffect,
    $queryRaw: vi.fn(async () => [{ tokens: options.spentBefore ?? 0n }]),
    $transaction: async (work: unknown): Promise<unknown> =>
      typeof work === "function" ? work(proxied) : Promise.all(work as unknown[]),
    run: {
      findUnique: vi.fn(async () => run),
      findUniqueOrThrow: vi.fn(async () => run),
      findFirst: vi.fn(async (args?: { where?: { status?: unknown } }) =>
        args?.where?.status === "queued"
          ? null
          : { bot: { notifyOnFinish: false }, thread: { groupId: null } },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where?: { status?: unknown; leaseOwner?: unknown; leaseFence?: unknown };
          data: Record<string, unknown>;
        }) => {
          if (typeof where?.status === "string" && where.status !== run.status) return { count: 0 };
          if (typeof where?.leaseOwner === "string" && where.leaseOwner !== run.leaseOwner)
            return { count: 0 };
          if (typeof where?.leaseFence === "number" && where.leaseFence !== run.leaseFence)
            return { count: 0 };
          Object.assign(run, data);
          return { count: 1 };
        },
      ),
    },
    bot: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.botId,
        name: "Assistant",
        title: "Assistant",
        description: "Test assistant",
        modelProvider: "local",
        modelId: "example-model",
        thinkingLevel: null,
        computerId: "computer-1",
        computerSwitching: false,
        monthlyTokenLimit: 1_000_000n,
        memoryScope: null,
        computer: { id: "computer-1", scope: "dedicated", kind: "e2b", homeKey: "home-1" },
      })),
      findUnique: vi.fn(async () => ({ name: "Assistant" })),
      findMany: vi.fn(async () => []),
    },
    attempt: {
      create: vi.fn(async () => ({ id: "attempt-1" })),
      findMany: vi.fn(async () => []),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    thread: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: run.threadId,
        groupId: null,
        historyCompactionSummary: null,
        historyCompactedUpToSeq: null,
        nextMessageSeq: 2,
      })),
    },
    message: {
      findMany: vi.fn(async () => [
        {
          id: "message-1",
          role: "user",
          runId: run.id,
          seq: 1,
          blocks: [{ kind: "text", text: "Click through the form" }],
        },
      ]),
      findUnique: vi.fn(async () => ({
        clientNonce: null,
        role: "user",
        blocks: [{ kind: "text", text: "Click through the form" }],
        threadId: run.threadId,
      })),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    task: {
      findUniqueOrThrow: vi.fn(async () => ({ id: run.taskId, prompt: "Click through the form" })),
    },
    computer: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findFirst: vi.fn(async () => ({
        state: "running",
        restorePending: false,
        screenGeneration: 0,
      })),
    },
    deploymentSettings: {
      findUnique: vi.fn(async () => ({
        defaultModelProvider: "local",
        defaultModelId: "example-model",
      })),
    },
  };
  // Models and methods the run touches but this test does not care about behave as empty tables.
  const table = (model: object) =>
    new Proxy(model, {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : emptyMethod(key)),
    });
  const emptyMethod = (key: string | symbol) =>
    empty[key as keyof typeof empty] ?? (async () => ({}));
  const proxied: object = new Proxy(prisma, {
    get: (target, key) =>
      typeof key === "string" && key.startsWith("$") && !(key in target)
        ? async () => []
        : table(key in target ? target[key as keyof typeof target] : empty),
  });
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const events = {
    append: vi.fn(async () => undefined),
    claimSteering: vi.fn(async () => []),
    notify: vi.fn(async () => undefined),
    finalizeRun,
    pauseRunForTakeover: vi.fn(async () => false),
  };
  const deps = {
    prisma: proxied,
    deploymentModelKey: "fake-deployment-key",
    runtime: new PiAgentRuntime(),
    sandbox: {
      describe: () => ({ id: "e2b", capabilities: { graphical: true } }),
      listFiles: vi.fn(async () => []),
      writeFile: vi.fn(async () => undefined),
      releaseScreen: vi.fn(async () => undefined),
      exportWorkspace: vi.fn(async function* () {
        yield* [];
      }),
    },
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    artifacts: { get: vi.fn(async () => new Uint8Array()) },
    events,
    jobs: { enqueue: vi.fn(async () => undefined) },
    notifications: { send: vi.fn(async () => undefined) },
    secrets: [],
    shutdownSignal,
  };
  const executor = createRunExecutor(deps as unknown as Parameters<typeof createRunExecutor>[0]);
  return { executor, finalizeRun, deps };
}

describe("a worker shutting down with a run in flight", () => {
  it("returns the unfinished run to the queue, and the next worker finishes it once", async () => {
    const run = newRun();
    const hanging = await startModel("hang");
    const shutdown = new AbortController();
    const first = await workerFor(run, hanging.url, shutdown.signal);
    let release!: () => void;
    const interrupted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = first.executor.continueRun(run.id, "worker-a").then(release);
    await vi.waitFor(() => expect(run.status).toBe("running"), { timeout: 10_000 });
    expect(run.leaseOwner).toBe("worker-a");
    // The model has started answering; the drain deadline passes.
    await new Promise((resolve) => setTimeout(resolve, 300));
    shutdown.abort(new Error("Worker is shutting down"));
    await Promise.all([running, interrupted]);
    await stopModel(hanging.server);

    expect(first.finalizeRun).not.toHaveBeenCalled();
    expect(run).toMatchObject({
      status: "queued",
      leaseOwner: null,
      leaseExpiresAt: null,
      wakeAt: null,
    });

    // The old pod cannot touch the run again once another worker owns it.
    const answering = await startModel("answer");
    const second = await workerFor(run, answering.url);
    const staleFence = run.leaseFence;
    await second.executor.continueRun(run.id, "worker-b");
    await stopModel(answering.server);
    expect(second.finalizeRun).toHaveBeenCalledTimes(1);
    expect(second.finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "completed",
        leaseOwner: "worker-b",
        leaseFence: staleFence + 1,
      }),
    );
    const { releaseRunForShutdown } = await import("./run-lifecycle.js");
    run.status = "running";
    run.leaseOwner = "worker-b";
    expect(await releaseRunForShutdown(first.deps as never, run.id, "worker-a", staleFence)).toBe(
      false,
    );
    expect(run.leaseOwner).toBe("worker-b");
  }, 40_000);
});
