import { randomBytes } from "node:crypto";
import type { Server as HttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentToolResultContent } from "@corvo/adapter-kit";
import { getLogger } from "@corvo/logging";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const TOKEN_BYTES = 24;
const PATH = /^\/mcp\/([0-9a-f]{48})$/;

export interface GatewayTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One turn's tools, fixed when the session opens, and where a call to one of them goes. */
export interface GatewaySession {
  tools: readonly GatewayTool[];
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: AgentToolResultContent[]; isError?: boolean }>;
}

type ReadResult = { body: unknown } | { status: 400 | 413 };

/** Reads a JSON body up to the limit; a body over it is drained, then refused. */
async function readBody(request: IncomingMessage): Promise<ReadResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES * 2) {
      request.destroy();
      return { status: 413 };
    }
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  }
  if (size > MAX_BODY_BYTES) return { status: 413 };
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { status: 400 };
  }
}

/**
 * A loopback MCP endpoint that serves one turn's tools at an unguessable path. It never decides
 * permission: allowed calls go to the session, which runs them through the executor's gate.
 */
export class CliToolGateway {
  private sessions = new Map<string, GatewaySession>();
  private http: HttpServer | undefined;
  private port = 0;
  private starting: Promise<void> | undefined;

  start(): Promise<void> {
    this.starting ??= new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        this.handle(request, response).catch((error) => {
          getLogger().error("cli tool gateway request failed", error);
          if (!response.headersSent) response.writeHead(500);
          response.end();
        });
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        this.http = server;
        resolve();
      });
    });
    return this.starting;
  }

  /** Opens a session at a new URL; the server starts on first use. */
  async open(session: GatewaySession): Promise<{ url: string; close(): void }> {
    await this.start();
    const token = randomBytes(TOKEN_BYTES).toString("hex");
    this.sessions.set(token, session);
    return {
      url: `http://127.0.0.1:${this.port}/mcp/${token}`,
      close: () => {
        this.sessions.delete(token);
      },
    };
  }

  async stop(): Promise<void> {
    this.sessions.clear();
    const server = this.http;
    this.http = undefined;
    this.starting = undefined;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const token = PATH.exec(path)?.[1];
    const session = token ? this.sessions.get(token) : undefined;
    // A wrong token and a wrong path look the same.
    if (!session) {
      response.writeHead(404).end();
      return;
    }
    // A web page never sends these; a page that reached the port by DNS rebinding sends its own Host.
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${this.port}`) {
      response.writeHead(403).end();
      return;
    }
    const read = await readBody(request);
    if ("status" in read) {
      response.writeHead(read.status, { connection: "close" }).end();
      return;
    }
    const server = new Server({ name: "corvo", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: session.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema: { type: "object" as const, ...inputSchema },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const { name } = call.params;
      if (!session.tools.some((tool) => tool.name === name)) {
        return {
          content: [{ type: "text" as const, text: `Tool not allowed: ${name}` }],
          isError: true,
        };
      }
      try {
        return await session.call(name, (call.params.arguments ?? {}) as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The tool failed.";
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.once("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, read.body);
  }
}
