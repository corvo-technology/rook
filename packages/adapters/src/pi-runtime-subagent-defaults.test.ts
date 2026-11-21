import { beforeEach, expect, it, vi } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";

const captured = vi.hoisted(() => ({
  states: [] as Array<{
    model: { id: string };
    thinkingLevel: string;
    tools: Array<{
      name: string;
      execute: (id: string, args: Record<string, unknown>) => Promise<unknown>;
    }>;
  }>,
  args: {} as Record<string, unknown>,
  reply: "",
}));

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state = { errorMessage: undefined, messages: [] };
    private readonly options: { initialState: (typeof captured.states)[number] };
    private listener?: (event: unknown) => void;
    constructor(options: never) {
      this.options = options;
      captured.states.push(this.options.initialState);
    }
    subscribe(listener: (event: unknown) => void) {
      this.listener = listener;
    }
    async prompt() {
      const tools = this.options.initialState.tools;
      if (tools.some((tool) => tool.name === "run_subagent")) {
        await tools
          .find((tool) => tool.name === "run_subagent")
          ?.execute("subagent-call", { name: "helper", task: "Look", ...captured.args });
      } else {
        this.listener?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: captured.reply },
        });
      }
    }
    async waitForIdle() {}
    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (provider: string, id: string) =>
      provider === "test"
        ? {
            provider,
            id,
            api: "openai-completions",
            baseUrl: "http://127.0.0.1/unused",
            contextWindow: 128_000,
            maxTokens: 4096,
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          }
        : undefined,
    streamSimple: () => {
      throw new Error("The fake agent must not make a model request");
    },
  }),
}));
vi.mock("./pi-local-provider.js", () => ({ registerLocalProvider: (models: unknown) => models }));
vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime } from "./pi-runtime.js";
import { SUBAGENT_RESULT_CHARS } from "./pi-runtime-subagent.js";

async function runParent(extra: { cheap?: boolean } = {}) {
  const events: Array<{ type: string; result?: string }> = [];
  for await (const event of new PiAgentRuntime().run(
    {
      botId: "bot",
      threadId: "thread",
      runId: "run",
      prompt: "Delegate.",
      instructions: "Brief.",
      history: [],
      tools: builtinAgentTools,
      model: { provider: "test", id: "big", thinkingLevel: "high" },
      resolveSubagentModel: extra.cheap
        ? async () => ({ provider: "test", id: "cheap", thinkingLevel: null })
        : undefined,
    },
    {
      operationId: "operation",
      traceId: "trace",
      spaceId: "space",
      userId: "user",
      signal: new AbortController().signal,
    },
  )) {
    events.push(event as never);
  }
  return events;
}

const helper = () => captured.states.at(-1)!;

beforeEach(() => {
  captured.states = [];
  captured.args = {};
  captured.reply = "done";
});

it("runs a helper on the cheap tier with low thinking and read-only tools by default", async () => {
  await runParent({ cheap: true });
  expect(helper().model.id).toBe("cheap");
  expect(helper().thinkingLevel).toBe("low");
  const names = helper().tools.map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining(["read_file", "web_search"]));
  for (const writing of ["write_file", "shell", "run_subagent", "message_user", "spawn_bot"]) {
    expect(names).not.toContain(writing);
  }
});

it("keeps the run's model when it has no cheap tier to offer, such as a pinned model", async () => {
  await runParent();
  expect(helper().model.id).toBe("big");
  expect(helper().thinkingLevel).toBe("high");
});

it("gives a helper exactly the tools its parent names, never delegation", async () => {
  captured.args = { tools: ["shell", "read_file", "run_subagent"] };
  await runParent({ cheap: true });
  expect(
    helper()
      .tools.map((tool) => tool.name)
      .sort(),
  ).toEqual(["read_file", "shell"]);
});

it("caps the summary a helper hands back", async () => {
  captured.reply = "x".repeat(SUBAGENT_RESULT_CHARS * 3);
  const events = await runParent({ cheap: true });
  const done = JSON.stringify(events);
  expect(done).not.toContain("x".repeat(SUBAGENT_RESULT_CHARS + 500));
});
