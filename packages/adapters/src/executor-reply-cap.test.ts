import { once } from "node:events";
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

const REQUEST_CAP = 40;

interface Step {
  /** Call a tool in this response. */
  tool?: boolean;
  text?: string;
  /** Tokens the provider reports for the response; null reports no counts. */
  usage?: number | null;
}

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

function clickBatch(size: number, request: number) {
  return {
    actions: Array.from({ length: size }, (_, index) => ({
      kind: "click",
      x: 100 + request * 7 + index,
      y: 200 + request * 3 + index * 2,
    })),
  };
}

function toolResultTexts(messages: Array<Record<string, unknown>>): string[] {
  return messages
    .filter((message) => message.role === "tool")
    .map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    );
}

/**
 * One real executor turn: real PiAgentRuntime and run loop against a fake OpenAI-compatible
 * server whose every answer is a computer_act call. `sizes` gives the batch size per request;
 * the last size repeats.
 */
async function runScript(
  script: Step[],
  options: { spentBefore?: bigint; leaseFence?: number } = {},
) {
  vi.stubEnv("CORVO_LOCAL_MODELS", "example-model");
  vi.stubEnv("CORVO_LOCAL_VISION_MODELS", "example-model");
  vi.stubEnv("CORVO_LOCAL_CONTEXT_WINDOW", "120000");
  const requests: Array<{ messages: Array<Record<string, unknown>> }> = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const n = requests.length;
      const chunk = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: `fixture-${n}`, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const step = script[Math.min(n - 1, script.length - 1)]!;
      const usage =
        step.usage === undefined
          ? ""
          : `data: ${JSON.stringify({
              id: `fixture-${n}`,
              choices: [],
              usage:
                step.usage === null
                  ? {}
                  : {
                      prompt_tokens: step.usage - 1,
                      completion_tokens: 1,
                      total_tokens: step.usage,
                    },
            })}\n\n`;
      response.writeHead(200, { "content-type": "text/event-stream" });
      if (n > REQUEST_CAP) {
        response.end(
          `${chunk({ role: "assistant", content: "Cap reached" }, "stop")}data: [DONE]\n\n`,
        );
        return;
      }
      if (step.tool) {
        response.end(
          chunk({
            role: "assistant",
            content: step.text,
            tool_calls: [
              {
                index: 0,
                id: `call-${n}`,
                type: "function",
                function: {
                  name: "computer_act",
                  arguments: JSON.stringify(clickBatch(1, n)),
                },
              },
            ],
          }) +
            chunk({}, "tool_calls") +
            usage +
            "data: [DONE]\n\n",
        );
        return;
      }
      response.end(
        chunk({ role: "assistant", content: step.text ?? "Done." }) +
          chunk({}, "stop") +
          usage +
          "data: [DONE]\n\n",
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture endpoint unavailable");
  vi.stubEnv("CORVO_LOCAL_MODELS_URL", `http://127.0.0.1:${address.port}/v1`);
  vi.resetModules();
  const { PiAgentRuntime } = await import("./pi-runtime.js");
  const { createRunExecutor } = await import("./executor.js");

  const run = {
    id: "run-1",
    botId: "bot-1",
    threadId: "thread-1",
    taskId: "task-1",
    spaceId: "space-1",
    userId: "user-1",
    status: "queued" as string,
    trigger: "user",
    sourceMessageId: "message-1",
    routineId: null,
    retryOfRunId: null,
    leaseOwner: null as string | null,
    leaseFence: options.leaseFence ?? 0,
    leaseExpiresAt: null as Date | null,
    wakeAt: null as Date | null,
  };
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
  const act = vi.fn(async (_computer: unknown, request: { actions: unknown[] }) => ({
    completed: request.actions.length,
  }));
  const sandbox = {
    describe: () => ({ id: "e2b", capabilities: { graphical: true } }),
    act,
    listFiles: vi.fn(async () => []),
    writeFile: vi.fn(async () => undefined),
    releaseScreen: vi.fn(async () => undefined),
    exportWorkspace: vi.fn(async function* () {
      yield* [];
    }),
  };
  const finalizeRun = vi.fn(async () => ({ continuationRunId: null }));
  const events = {
    append: vi.fn(async () => undefined),
    claimSteering: vi.fn(async () => []),
    notify: vi.fn(async () => undefined),
    finalizeRun,
    pauseRunForTakeover: vi.fn(async () => false),
  };
  const executor = createRunExecutor({
    prisma: proxied,
    deploymentModelKey: "fake-deployment-key",
    runtime: new PiAgentRuntime(),
    sandbox,
    home: { commit: vi.fn(async () => "fixture-revision") },
    memory: { read: async () => ({ documents: [] }) },
    memoryProviders: { resolve: async () => null },
    artifacts: { get: vi.fn(async () => new Uint8Array()) },
    events,
    jobs: { enqueue: vi.fn(async () => undefined) },
    notifications: { send: vi.fn(async () => undefined) },
    secrets: [],
    // Ends the run if the guard is missing, instead of letting the fake server answer forever.
    shutdownSignal: AbortSignal.timeout(20_000),
  } as unknown as Parameters<typeof createRunExecutor>[0]);

  try {
    await executor.continueRun(run.id, "worker-1");
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  return { requests, act, finalizeRun };
}

const REFUSAL_TEXT = "This reply reached its token cap. Do not call more tools.";

describe("the per-reply token cap through the run loop", () => {
  it("refuses tools past the cap and lets the reply wrap up", async () => {
    const { requests, act, finalizeRun } = await runScript([
      { tool: true, usage: 100_001 },
      { text: "Wrapped up." },
    ]);
    expect(requests).toHaveLength(2);
    expect(act).not.toHaveBeenCalled();
    expect(toolResultTexts(requests[1]!.messages).at(-1)).toContain(REFUSAL_TEXT);
    expect(finalizeRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
    expect(finalizeRun).not.toHaveBeenCalledWith(
      expect.objectContaining({ stopReason: expect.anything() }),
    );
  }, 30_000);

  it("cuts a reply that keeps calling tools", async () => {
    const { requests, act, finalizeRun } = await runScript([
      { tool: true, usage: 100_001, text: "Working on it." },
      { tool: true },
    ]);
    expect(act).not.toHaveBeenCalled();
    expect(requests).toHaveLength(4);
    expect(finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "failed",
        error: "This reply reached its token cap.",
        stopReason: "reply_cap",
        partialReply: [
          expect.objectContaining({ text: expect.stringContaining("Working on it.") }),
        ],
      }),
    );
  }, 30_000);

  it("cuts a reply that passes 1.3 times the cap without a tool call", async () => {
    const { finalizeRun } = await runScript([{ text: "A very long answer.", usage: 130_001 }]);
    expect(finalizeRun).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", stopReason: "reply_cap" }),
    );
  }, 30_000);

  it("counts what earlier attempts of the run spent", async () => {
    const { requests, act } = await runScript([{ tool: true }, { text: "Wrapped up." }], {
      spentBefore: 100_001n,
      leaseFence: 1,
    });
    expect(act).not.toHaveBeenCalled();
    expect(toolResultTexts(requests[1]!.messages).at(-1)).toContain(REFUSAL_TEXT);
  }, 30_000);

  it("never caps on a provider that reports no token counts", async () => {
    const script: Step[] = [
      ...Array.from({ length: 12 }, () => ({ tool: true, usage: null })),
      { text: "All done.", usage: null },
    ];
    const { act, finalizeRun } = await runScript(script);
    expect(act).toHaveBeenCalledTimes(12);
    expect(finalizeRun).toHaveBeenCalledWith(expect.objectContaining({ outcome: "completed" }));
  }, 30_000);
});
