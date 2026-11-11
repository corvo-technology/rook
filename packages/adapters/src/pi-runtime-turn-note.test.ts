import { once } from "node:events";
import { createServer } from "node:http";
import type { AgentRunRequest } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "./pi-runtime.js";

interface Captured {
  messages: Array<{ role: string; content: unknown }>;
}

async function send(
  overrides: Partial<AgentRunRequest> & Pick<AgentRunRequest, "history" | "prompt">,
): Promise<Captured> {
  const requests: Captured[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Done" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture endpoint unavailable");
  try {
    for await (const _event of new PiAgentRuntime().run(
      {
        botId: "bot-fixture",
        threadId: "thread-turn-note",
        runId: `run-${Math.random().toString(36).slice(2)}`,
        instructions: "Stable.",
        tools: [],
        contextStrategy: "current",
        model: {
          provider: "openai-compatible",
          id: "fixture",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          allowPrivateEndpoint: true,
        },
        ...overrides,
      },
      { signal: AbortSignal.timeout(15_000) },
    )) {
    }
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

// Chat Completions payloads merge adjacent user turns with a blank line, so the fixture
// compares the joined conversation text.
const conversation = (request: Captured) =>
  request.messages
    .filter((message) => message.role !== "system")
    .map((message) => message.content)
    .join("\n\n");

describe("turn note", () => {
  const history = [
    { id: "m0", role: "user" as const, content: "first" },
    { id: "a0", role: "assistant" as const, content: "reply" },
    { id: "m2", role: "user" as const, content: "second" },
  ];

  it("keeps the newest source message as its own block and sends the note after it", async () => {
    const request = await send({
      history,
      sourceMessageId: "m2",
      prompt: "second\n\nCOMBINED",
      turnNote: "NOTE",
    });
    expect(conversation(request)).toBe("first\n\nAssistant: reply\n\nsecond\n\nNOTE");
  });

  it("falls back to one combined prompt when the source message is not the newest", async () => {
    const request = await send({
      history: [...history, { id: "m3", role: "user" as const, content: "third" }],
      sourceMessageId: "m2",
      prompt: "second\n\nCOMBINED",
      turnNote: "NOTE",
    });
    expect(conversation(request)).toBe("first\n\nAssistant: reply\n\nthird\n\nsecond\n\nCOMBINED");
  });

  it("falls back when no turn note is given", async () => {
    const request = await send({
      history,
      sourceMessageId: "m2",
      prompt: "second\n\nCOMBINED",
    });
    expect(conversation(request)).toBe("first\n\nAssistant: reply\n\nsecond\n\nCOMBINED");
  });
});
