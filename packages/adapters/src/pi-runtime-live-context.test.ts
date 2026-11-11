import { once } from "node:events";
import { createServer } from "node:http";
import type { AgentRunRequest } from "@corvo/adapter-kit";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "./pi-runtime.js";
import { PromptSessions } from "./prompt-session.js";
import { EMPTY_LIVE_CONTEXT } from "./run-instructions.js";

type History = AgentRunRequest["history"];

/** One runtime and fixture server for a thread; each turn returns what the model was sent. */
async function thread() {
  const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  let hang = false;
  let onRequest: (() => void) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      bodies.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      onRequest?.();
      if (hang) return;
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
  const runtime = new PiAgentRuntime({ promptSessions: new PromptSessions() });
  let runs = 0;
  // Chat Completions payloads merge adjacent user turns with a blank line.
  const conversation = () =>
    bodies
      .at(-1)!
      .messages.filter((message) => message.role !== "system")
      .map((message) => message.content)
      .join("\n\n");
  return {
    conversation,
    setHang(value: boolean) {
      hang = value;
    },
    async turn(history: History, live: string, options: { stop?: boolean } = {}) {
      const source = history.at(-1)!;
      const controller = new AbortController();
      if (options.stop) onRequest = () => controller.abort();
      try {
        for await (const _event of runtime.run(
          {
            botId: "bot-live",
            threadId: "thread-live",
            runId: `run-${++runs}`,
            instructions: "Stable.",
            prompt: `${source.content}\n\nCOMBINED`,
            turnNote: `note ${source.id}`,
            liveContext: live,
            sourceMessageId: source.id,
            history,
            tools: [],
            contextStrategy: "current",
            model: {
              provider: "openai-compatible",
              id: "fixture",
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              allowPrivateEndpoint: true,
            },
          },
          { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) },
        )) {
        }
      } catch {
        // A stopped run ends the stream early.
      } finally {
        onRequest = undefined;
      }
      return conversation();
    },
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

const user = (id: string): History[number] => ({ id, role: "user", content: `user ${id}` });
const reply = (id: string): History[number] => ({ id, role: "assistant", content: `reply ${id}` });

describe("live context in the transcript", () => {
  it("replays the block, resends it only when it changed, and says so when it empties", async () => {
    const fixture = await thread();
    try {
      const h1 = [user("m1")];
      expect(await fixture.turn(h1, "L1")).toBe("L1\n\nuser m1\n\nnote m1");

      const h2 = [...h1, reply("a1"), user("m2")];
      expect(await fixture.turn(h2, "L1")).toBe(
        "L1\n\nuser m1\n\nAssistant: reply a1\n\nuser m2\n\nnote m2",
      );

      const h3 = [...h2, reply("a2"), user("m3")];
      expect(await fixture.turn(h3, "L2")).toBe(
        "L1\n\nuser m1\n\nAssistant: reply a1\n\nuser m2\n\nAssistant: reply a2\n\nL2\n\nuser m3\n\nnote m3",
      );

      const h4 = [...h3, reply("a3"), user("m4")];
      const fourth = await fixture.turn(h4, "");
      expect(fourth).toContain(`\n\n${EMPTY_LIVE_CONTEXT}\n\nuser m4\n\nnote m4`);
      expect(fourth.startsWith("L1\n\nuser m1")).toBe(true);
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("starts fresh after a stopped turn, sending only the current block before the user block", async () => {
    const fixture = await thread();
    try {
      const h1 = [user("m1")];
      await fixture.turn(h1, "L1");
      const h2 = [...h1, reply("a1"), user("m2")];
      fixture.setHang(true);
      await fixture.turn(h2, "L1", { stop: true });
      fixture.setHang(false);
      const h3 = [...h2, user("m3")];
      expect(await fixture.turn(h3, "L1")).toBe(
        "user m1\n\nAssistant: reply a1\n\nuser m2\n\nL1\n\nuser m3\n\nnote m3",
      );
    } finally {
      await fixture.close();
    }
  }, 30_000);

  it("starts fresh when an earlier message was edited", async () => {
    const fixture = await thread();
    try {
      const h1 = [user("m1")];
      await fixture.turn(h1, "L1");
      const h2 = [...h1, reply("a1"), user("m2")];
      await fixture.turn(h2, "L1");
      const edited = [{ ...h2[0]!, content: "user m1 edited" }, ...h2.slice(1), reply("a2")];
      const h3 = [...edited, user("m3")];
      expect(await fixture.turn(h3, "L1")).toBe(
        "user m1 edited\n\nAssistant: reply a1\n\nuser m2\n\nAssistant: reply a2\n\nL1\n\nuser m3\n\nnote m3",
      );
    } finally {
      await fixture.close();
    }
  }, 30_000);
});
