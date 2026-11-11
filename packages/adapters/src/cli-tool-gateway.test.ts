import { request as httpRequest } from "node:http";
import { createLogger, createTestSink, installLogger } from "@corvo/logging";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewaySession } from "./cli-tool-gateway.js";
import { CliToolGateway } from "./cli-tool-gateway.js";

const tool = (name: string) => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: "object", properties: {} },
});

function session(names: string[], call = vi.fn()): GatewaySession & { call: typeof call } {
  call.mockImplementation(async (name: string) => ({
    content: [{ type: "text", text: `ran ${name}` }],
  }));
  return { tools: names.map(tool), call };
}

async function connect(url: string) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

/** A raw request, so Host and Origin can be set freely. */
function raw(
  url: string,
  options: { headers?: Record<string, string>; body?: string; path?: string },
): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: options.path ?? target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...options.headers,
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end(options.body ?? "{}");
  });
}

describe("CliToolGateway", () => {
  let gateway: CliToolGateway;
  beforeEach(() => {
    gateway = new CliToolGateway();
  });
  afterEach(async () => {
    await gateway.stop();
  });

  it("lists exactly the session's tools and runs allowed calls only", async () => {
    const s = session(["a", "b"]);
    const { url } = await gateway.open(s);
    const client = await connect(url);
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(["a", "b"]);
    await client.callTool({ name: "a", arguments: { x: 1 } });
    expect(s.call).toHaveBeenCalledWith("a", { x: 1 });
    const refused = await client.callTool({ name: "zzz", arguments: {} });
    expect(refused.isError).toBe(true);
    expect(s.call).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("answers 404 for a closed session", async () => {
    const { url, close } = await gateway.open(session(["a"]));
    close();
    const client = new Client({ name: "test", version: "1" });
    await expect(client.connect(new StreamableHTTPClientTransport(new URL(url)))).rejects.toThrow();
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(404);
  });

  it("refuses browsers, rebinding, wrong tokens, wrong paths and large bodies", async () => {
    const { url } = await gateway.open(session(["a"]));
    const port = new URL(url).port;
    expect(await raw(url, { headers: { origin: "https://example.com" } })).toBe(403);
    expect(await raw(url, { headers: { host: `evil.example:${port}` } })).toBe(403);
    expect(await raw(url, { path: `/mcp/${"0".repeat(48)}` })).toBe(404);
    expect(await raw(url, { path: "/other" })).toBe(404);
    expect(await raw(url, { body: "x".repeat(9 * 1024 * 1024) })).toBe(413);
  });

  it("keeps two sessions apart", async () => {
    const first = await gateway.open(session(["a"]));
    const second = await gateway.open(session(["b"]));
    const c1 = await connect(first.url);
    const c2 = await connect(second.url);
    expect((await c1.listTools()).tools.map((t) => t.name)).toEqual(["a"]);
    expect((await c2.listTools()).tools.map((t) => t.name)).toEqual(["b"]);
    first.close();
    expect((await c2.listTools()).tools.map((t) => t.name)).toEqual(["b"]);
    await c1.close();
    await c2.close();
  });

  it("never logs the token", async () => {
    const sink = createTestSink();
    installLogger(createLogger({ service: "test", sinks: [sink] }));
    const { url } = await gateway.open(session(["a"]));
    const token = url.split("/").pop() as string;
    const client = await connect(url);
    await client.listTools();
    await raw(url, { path: "/mcp/short" });
    await client.close();
    expect(JSON.stringify(sink.events)).not.toContain(token);
  });
});
