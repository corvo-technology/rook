import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  gatewayEnabled,
  gatewayScreenPath,
  gatewayScreenPathWithToken,
  gatewaySocketHasToken,
  gatewayUpstreamPort,
  parseGatewayUrl,
  proxyGatewayHttp,
  proxyGatewayUpgrade,
  refuseGatewayUpgrade,
} from "./gateway.js";

const id = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const servers: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function listen(server: http.Server | net.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

describe("gateway addressing", () => {
  it("is off unless asked for, and refuses a misspelled setting", () => {
    expect(gatewayEnabled(undefined)).toBe(false);
    expect(gatewayEnabled("true")).toBe(true);
    expect(() => gatewayEnabled("yes")).toThrow("must be");
  });

  it("builds a screen path that carries only the container, never an address", () => {
    expect(gatewayScreenPath(id)).toBe(`/gateway/${id}/embed.html`);
    const withToken = gatewayScreenPathWithToken(gatewayScreenPath(id), "a b");
    expect(withToken).toBe(`/gateway/${id}/embed.html?path=websockify%3Ftoken%3Da%2520b`);
  });

  it("splits a gateway URL into the container and the path the computer sees", () => {
    expect(parseGatewayUrl(`/gateway/${id}/app/ui.js?x=1`)).toMatchObject({
      containerId: id,
      upstreamPath: "/app/ui.js?x=1",
      pathname: "/app/ui.js",
    });
    expect(parseGatewayUrl(`/gateway/${id}`)?.upstreamPath).toBe("/");
  });

  it.each([
    ["not a gateway path", "/computers/abc"],
    ["no container", "/gateway//embed.html"],
    ["a name that is not a container id", "/gateway/Bot-1/embed.html"],
    ["a short id", "/gateway/abc/embed.html"],
    ["a traversal", `/gateway/${id}/../x`],
    ["an encoded traversal", `/gateway/${id}/%2e%2e/x`],
    ["a backslash", `/gateway/${id}/a%5Cb`],
    ["a null byte", `/gateway/${id}/a%00b`],
  ])("refuses %s", (_name, url) => {
    expect(parseGatewayUrl(url)).toBeNull();
  });

  it("asks a websocket for the token the computer checks, and nothing else for a page", () => {
    const parsed = (query: string) => parseGatewayUrl(`/gateway/${id}/websockify${query}`)!;
    expect(gatewaySocketHasToken(parsed("").search, parsed("").pathname)).toBe(false);
    expect(gatewaySocketHasToken(parsed("?token=").search, "/websockify")).toBe(false);
    expect(gatewaySocketHasToken(parsed("?token=a b").search, "/websockify")).toBe(false);
    expect(gatewaySocketHasToken(parsed("?token=abc_123-X").search, "/websockify")).toBe(true);
    expect(gatewaySocketHasToken(new URLSearchParams(), "/embed.html")).toBe(true);
  });

  it("only ever reaches the screen port", () => {
    expect(gatewayUpstreamPort()).toBe(6080);
  });
});

describe("gateway HTTP proxy", () => {
  it("forwards the path, hides the supervisor's authority and returns the page", async () => {
    let seen: http.IncomingMessage | undefined;
    const port = await listen(
      http.createServer((req, res) => {
        seen = req;
        res.setHeader("set-cookie", "leak=1");
        res.setHeader("content-type", "text/html");
        res.end(`<p>${req.url}</p>`);
      }),
    );
    const target = parseGatewayUrl(`/gateway/${id}/embed.html?path=websockify`)!;
    const response = await proxyGatewayHttp(
      new Request("http://supervisor.test/anything", {
        headers: {
          authorization: "Bearer supervisor-token",
          cookie: "session=1",
          "x-corvo-bot-id": "bot",
          "x-corvo-space-id": "space",
          accept: "text/html",
        },
      }),
      target,
      { host: "127.0.0.1", port },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<p>/embed.html?path=websockify</p>");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(seen?.headers.authorization).toBeUndefined();
    expect(seen?.headers.cookie).toBeUndefined();
    expect(seen?.headers["x-corvo-bot-id"]).toBeUndefined();
    expect(seen?.headers.accept).toBe("text/html");
    expect(seen?.headers.host).toBe(`127.0.0.1:${port}`);
  });

  it("passes the status of a missing asset through", async () => {
    const port = await listen(
      http.createServer((_req, res) => {
        res.statusCode = 404;
        res.end("nope");
      }),
    );
    const response = await proxyGatewayHttp(
      new Request("http://supervisor.test/x"),
      parseGatewayUrl(`/gateway/${id}/missing.js`)!,
      { host: "127.0.0.1", port },
    );
    expect(response.status).toBe(404);
  });

  it("answers 502 when the computer's screen server is not there", async () => {
    const closed = net.createServer();
    const port = await listen(closed);
    closed.close();
    const response = await proxyGatewayHttp(
      new Request("http://supervisor.test/x"),
      parseGatewayUrl(`/gateway/${id}/embed.html`)!,
      { host: "127.0.0.1", port },
    );
    expect(response.status).toBe(502);
  });
});

describe("gateway websocket proxy", () => {
  it("carries the upgrade and the bytes both ways, without the supervisor's token", async () => {
    let handshake = "";
    const upstream = net.createServer((socket) => {
      socket.once("data", (chunk) => {
        handshake = chunk.toString();
        socket.write("HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\n\r\npong");
        socket.on("data", (data) => socket.write(`echo:${data}`));
      });
    });
    const upstreamPort = await listen(upstream);
    const front = http.createServer();
    front.on("upgrade", (req, socket, head) => {
      const target = parseGatewayUrl(req.url)!;
      proxyGatewayUpgrade(req, socket, head, target, { host: "127.0.0.1", port: upstreamPort });
    });
    const frontPort = await listen(front);

    const client = net.connect(frontPort, "127.0.0.1");
    const received: string[] = [];
    client.on("data", (chunk) => received.push(chunk.toString()));
    client.write(
      [
        `GET /gateway/${id}/websockify?token=abc HTTP/1.1`,
        "host: 10.8.0.2:7091",
        "connection: Upgrade",
        "upgrade: websocket",
        "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==",
        "authorization: Bearer supervisor-token",
        "x-corvo-bot-id: bot",
        "",
        "",
      ].join("\r\n"),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.write("ping");
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.destroy();

    expect(handshake).toContain("GET /websockify?token=abc HTTP/1.1");
    expect(handshake.toLowerCase()).toContain(
      "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==".toLowerCase(),
    );
    expect(handshake.toLowerCase()).not.toContain("authorization");
    expect(handshake.toLowerCase()).not.toContain("x-corvo-bot-id");
    expect(handshake).toContain(`host: 127.0.0.1:${upstreamPort}`);
    expect(received.join("")).toContain("101 Switching Protocols");
    expect(received.join("")).toContain("echo:ping");
  });

  it("refuses with a plain status the browser's socket understands", async () => {
    const front = http.createServer();
    front.on("upgrade", (_req, socket) =>
      refuseGatewayUpgrade(socket, 403, "invalid computer identity"),
    );
    const port = await listen(front);
    const client = net.connect(port, "127.0.0.1");
    const received: string[] = [];
    client.on("data", (chunk) => received.push(chunk.toString()));
    client.write("GET / HTTP/1.1\r\nhost: x\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    client.destroy();
    expect(received.join("")).toMatch(/^HTTP\/1\.1 403 invalid computer identity/);
  });
});
