// A stand-in for the Claude Code CLI, driven only by its environment and stdin. Tests never run
// the real program. It speaks the same stream-json lines the recorded fixtures show.
import { appendFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (args[0] === "--version") {
  console.log(process.env.FAKE_CLAUDE_VERSION ?? "9.9.9");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
  console.log(process.env.FAKE_CLAUDE_AUTH ?? '{"loggedIn":true,"authMethod":"claude.ai"}');
  process.exit(0);
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString("utf8");

const client = new Client({ name: "fake-claude", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.CORVO_MCP_URL)));
const listed = (await client.listTools()).tools.map((tool) => tool.name);

// Names only, never values: the log shows what the child was given without copying secrets.
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(
    process.env.FAKE_CLAUDE_LOG,
    `${JSON.stringify({ argv: args, env: Object.keys(process.env), stdin, tools: listed })}\n`,
  );
}

const tools = listed.map((name) => `mcp__corvo__${name}`);
if (process.env.FAKE_CLAUDE_EXTRA_TOOL) tools.push(process.env.FAKE_CLAUDE_EXTRA_TOOL);
out({
  type: "system",
  subtype: "init",
  tools,
  mcp_servers: [{ name: "corvo", status: "connected" }],
  apiKeySource: "none",
});

const say = (text) => {
  out({ type: "stream_event", event: { type: "message_start" } });
  out({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  });
};
say("Working. ");

if (stdin.includes("HANG")) {
  // Keep the event loop alive until a signal ends the process.
  setInterval(() => {}, 1_000);
  await new Promise(() => {});
}

const call = stdin.match(/CALL (\S+) (\{.*\})/);
if (call) {
  out({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "t1", name: `mcp__corvo__${call[1]}`, input: {} }],
    },
  });
  const result = await client.callTool({ name: call[1], arguments: JSON.parse(call[2]) });
  const text = result.content.map((part) => part.text ?? "").join("");
  say(`Result: ${text}`);
}

out({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ok",
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 2,
    cache_read_input_tokens: 3,
    output_tokens: 5,
  },
});
await client.close();
process.exit(0);
